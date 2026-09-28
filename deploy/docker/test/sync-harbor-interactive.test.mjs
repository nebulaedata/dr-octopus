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
function session(answers = [...defaults], loginError) {
  const events = [];
  const messages = [];
  const prompt = async (options) => {
    assert.ok(answers.length, 'Unexpected prompt');
    const value = answers.shift();
    if (options.validate && value !== cancel) assert.equal(options.validate(value), undefined);
    events.push('prompt');
    return value;
  };
  return {
    events,
    messages,
    dependencies: {
      validateOptions: syncOptions,
      ui: {
        intro: (text) => messages.push(text),
        outro: (text) => messages.push(text),
        note: (text) => messages.push(text),
        cancel: (text) => messages.push(text),
        isCancel: (value) => value === cancel,
        text: prompt,
        confirm: prompt,
        log: { info: (text) => messages.push(text), success: (text) => messages.push(text) },
      },
      login: async (registry) => {
        events.push(['login', registry]);
        if (loginError) throw loginError;
      },
      sync: (args, options) =>
        syncHarbor(args, {
          ...options,
          run: (command) => {
            events.push(command);
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
