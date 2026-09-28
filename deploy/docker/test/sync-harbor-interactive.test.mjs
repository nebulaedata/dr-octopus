/**
 * @author Codex
 * @description Exercises interactive login, cancellation and exact-snapshot confirmation without credentials or network.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { interactiveSync } from '../sync-harbor-interactive.mjs';
import { syncHarbor, syncOptions } from '../sync-harbor.mjs';

const cancel = Symbol('cancel');
const digest = `sha256:${'a'.repeat(64)}`;
const defaults = ['harbor.example.com', true, 'team', '0.0.10', true];

/**
 * Supplies terminal answers while retaining the real sync validation, confirmation and command ordering.
 */
function session(answers = [...defaults], loginError, runtime = {}) {
  const events = [];
  const messages = [];
  const statuses = [];
  let active = false;
  let cancelSpinner;
  const display = (text) => {
    assert.equal(active, false, 'Spinner must not overlap prompts or logs');
    messages.push(text);
  };
  const prompt = async (options) => {
    assert.equal(active, false, 'Spinner must stop before prompting');
    assert.ok(answers.length, 'Unexpected prompt');
    const value = answers.shift();
    if (options.validate && value !== cancel) assert.equal(options.validate(value), undefined);
    events.push('prompt');
    return value;
  };
  return {
    events,
    messages,
    statuses,
    get active() {
      return active;
    },
    cancelSpinner: () => cancelSpinner(),
    dependencies: {
      validateOptions: syncOptions,
      ui: {
        intro: display,
        outro: display,
        note: display,
        cancel: display,
        spinner: ({ onCancel }) => {
          cancelSpinner = () => {
            active = false;
            onCancel();
          };
          return {
            start: (text) => {
              assert.equal(active, false, 'Only one spinner can own the terminal');
              active = true;
              statuses.push(text);
            },
            message: (text) => {
              assert.equal(active, true);
              statuses.push(text);
            },
            clear: () => {
              active = false;
            },
            error: (text) => {
              active = false;
              messages.push(text);
            },
          };
        },
        isCancel: (value) => value === cancel,
        text: prompt,
        confirm: prompt,
        log: { info: display, success: display },
      },
      login: async (registry) => {
        assert.equal(active, false, 'Docker must own the terminal during login');
        events.push(['login', registry]);
        if (loginError) throw loginError;
      },
      sync: (args, options) =>
        syncHarbor(args, {
          ...options,
          ...runtime,
          run: (command, context) => {
            assert.equal(active, true, 'Network requests must show a spinner');
            events.push(command);
            if (runtime.run) return runtime.run(command, context);
            return command[2] === 'inspect' ? digest : '';
          },
        }),
    },
  };
}

test('interactive flow logs in before resolving and confirms the exact snapshot before pushing', async () => {
  const state = session();
  const result = await interactiveSync(syncOptions([]), state.dependencies);
  assert.equal(result.target, 'harbor.example.com/team/dr-octopus:0.0.10');
  assert.equal(result.copied, true);
  const commands = state.events.filter(Array.isArray);
  assert.deepEqual(commands[0], ['login', 'harbor.example.com']);
  assert.equal(commands[1][2], 'inspect');
  assert.equal(commands[2][2], 'create');
  assert.equal(commands[2].at(-1), `docker.io/nebulaedata01/dr-octopus@${digest}`);
  const copyIndex = state.events.indexOf(commands[2]);
  assert.equal(state.events[copyIndex - 1], 'prompt');
  assert.ok(state.messages.some((message) => message.includes('摘要校验通过')));
  assert.equal(state.statuses.length, 3);
  assert.equal(state.active, false);
});

test('network failures at any stage stop the spinner and never report completion', async () => {
  for (const failureAt of [1, 2, 3]) {
    let calls = 0;
    const state = session([...defaults], undefined, {
      run: (command) => {
        if (++calls === failureAt) throw new Error('access denied');
        return command[2] === 'inspect' ? digest : '';
      },
    });
    await assert.rejects(interactiveSync(syncOptions([]), state.dependencies), /access denied/);
    assert.equal(state.active, false);
    assert.ok(state.messages.every((message) => !message.includes('同步完成')));
  }
});

test('retry waits retain animated feedback and resume the correct operation', async () => {
  const results = [new Error('EOF'), digest, new Error('EOF'), new Error(': not found'), '', digest];
  let waits = 0;
  const state = session([...defaults], undefined, {
    run: () => {
      const result = results.shift();
      if (result instanceof Error) throw result;
      return result;
    },
    pause: async () => {
      waits++;
      assert.equal(state.active, true);
      assert.match(state.statuses.at(-1), /秒后重试/);
    },
  });
  assert.equal((await interactiveSync(syncOptions([]), state.dependencies)).copied, true);
  assert.equal(waits, 2);
  assert.ok(state.statuses.some((message) => message.includes('核实 Harbor')));
  assert.match(state.statuses.at(-1), /校验 Harbor/);
  assert.equal(state.active, false);
});

test('spinner cancellation aborts an in-flight copy and prevents subsequent requests', async () => {
  const state = session([...defaults], undefined, {
    run: async (command, { signal, quiet }) => {
      assert.equal(quiet, true);
      if (command[2] === 'inspect') return digest;
      state.cancelSpinner();
      signal.throwIfAborted();
    },
  });
  const result = await interactiveSync(syncOptions([]), state.dependencies);
  assert.equal(result.cancelled, true);
  assert.equal(state.events.filter(Array.isArray).length, 3);
  assert.equal(state.active, false);
  assert.ok(state.messages.some((message) => message.includes('目标可能已有部分数据')));
});

test('cancelling during backoff stops without another network request', async () => {
  const state = session([...defaults], undefined, {
    run: () => {
      throw new Error('EOF');
    },
    pause: async (_delay, _value, { signal }) => {
      state.cancelSpinner();
      signal.throwIfAborted();
    },
  });
  assert.equal((await interactiveSync(syncOptions([]), state.dependencies)).cancelled, true);
  assert.equal(state.events.filter(Array.isArray).length, 2);
  assert.equal(state.active, false);
});

test('cancelling any prompt or declining either confirmation never pushes', async () => {
  for (let index = 0; index < defaults.length; index++) {
    const state = session([...defaults.slice(0, index), cancel]);
    const result = await interactiveSync(syncOptions([]), state.dependencies);
    assert.equal(result.cancelled, true);
    assert.ok(state.events.every((event) => !Array.isArray(event) || event[2] !== 'create'));
    if (index <= 1) assert.ok(state.events.every((event) => !Array.isArray(event)));
  }
  for (const index of [1, 4]) {
    const state = session([...defaults.slice(0, index), false]);
    assert.equal((await interactiveSync(syncOptions([]), state.dependencies)).cancelled, true);
    assert.ok(state.events.every((event) => !Array.isArray(event) || event[2] !== 'create'));
  }
});

test('failed login stops before source resolution and never reports login or sync success', async () => {
  const state = session(defaults.slice(0, 2), new Error('login failed'));
  await assert.rejects(interactiveSync(syncOptions([]), state.dependencies), /login failed/);
  assert.deepEqual(state.events.filter(Array.isArray), [['login', 'harbor.example.com']]);
  assert.ok(state.messages.every((message) => !message.includes('成功') && !message.includes('同步完成')));
});
