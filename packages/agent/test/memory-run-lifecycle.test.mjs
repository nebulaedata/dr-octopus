/**
 * @author Codex
 * @description Verify memory run ownership, delayed startup and terminal feedback without network services.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { registerMemoryEvents } from '../dist/extensions/memory/extension/events.js';

/**
 * Hold only external timing under test control while exercising production lifecycle handlers.
 */
function fixture(overrides = {}, readOnly = false, screen) {
  const events = new Map();
  const messages = [],
    statuses = [],
    logs = [],
    branch = [],
    evaluations = [];
  const status = {
    version: 1,
    mode: 'auto',
    storeId: 'store',
    revision: 0,
    count: 0,
    writeEpoch: 0,
    availability: 'ready',
  };
  const service = {
    initialize: async () => status,
    getStatus: async () => status,
    dispose: async () => {},
    evaluateRun: async (...args) => {
      evaluations.push(args);
      return [];
    },
    ...overrides,
  };
  const pi = {
    on: (type, handler) => events.set(type, handler),
    getActiveTools: () => ['memory_read', 'memory_recall'],
    sendMessage: (message, options) => messages.push({ ...message, options }),
  };
  const ctx = {
    mode: 'rpc',
    isProjectTrusted: () => true,
    ui: { setStatus: (_key, value) => statuses.push(JSON.parse(value)) },
    sessionManager: { getSessionId: () => 'session', getBranch: () => branch },
  };
  registerMemoryEvents(pi, service, readOnly, (...args) => logs.push(args), screen);
  return { events, messages, statuses, logs, branch, evaluations, ctx, status };
}

/**
 * Start one accepted user run with a controlled main-model terminal result.
 */
async function run(f, stopReason = 'stop', text = '记住我') {
  await f.events.get('before_agent_start')({ systemPrompt: 'base' }, f.ctx);
  f.branch.push({
    id: 'user-' + f.branch.length,
    type: 'message',
    message: { role: 'user', content: text },
  });
  f.events.get('agent_end')({ messages: [{ role: 'assistant', stopReason }] }, f.ctx);
  await f.events.get('agent_settled')({}, f.ctx);
}

test('duplicate settled events consume one run, including explicit empty outcomes', async () => {
  const f = fixture();
  await run(f);
  await f.events.get('agent_settled')({}, f.ctx);
  assert.equal(f.evaluations.length, 1);
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].customType, 'octopus-memory-outcome');
  assert.equal(f.messages[0].options.triggerTurn, false);
});

test('late initialization cannot publish after a Session switch or shutdown', async () => {
  for (const terminal of ['session_before_switch', 'session_shutdown']) {
    let resolve;
    const initialization = new Promise((done) => {
      resolve = done;
    });
    const f = fixture({
      initialize: () => initialization,
      dispose: async () => {
        resolve(f.status);
      },
    });
    f.events.get('session_start')({}, f.ctx);
    await f.events.get(terminal)({}, f.ctx);
    resolve(f.status);
    await initialization;
    await Promise.resolve();
    assert.deepEqual(f.statuses, []);
    assert.deepEqual(f.messages, []);
  }
});

test('failed or aborted main runs report no save without invoking curation', async () => {
  for (const stopReason of ['error', 'aborted']) {
    const f = fixture();
    await run(f, stopReason);
    assert.equal(f.evaluations.length, 0);
    assert.match(f.messages[0].content, /中止或失败/);
  }
});

test('read-only and untrusted runs report the restriction without invoking curation', async () => {
  for (const readOnly of [true, false]) {
    const f = fixture({}, readOnly);
    if (!readOnly) f.ctx.isProjectTrusted = () => false;
    await run(f);
    assert.equal(f.evaluations.length, 0);
    assert.match(f.messages[0].content, /不允许写入/);
  }
});

test('a late curation response cannot publish into a replacement Session', async () => {
  let resolve, began;
  const started = new Promise((done) => {
    began = done;
  });
  const f = fixture({
    evaluateRun: () => {
      began();
      return new Promise((done) => {
        resolve = done;
      });
    },
  });
  const running = run(f);
  await started;
  f.events.get('session_before_switch')({}, f.ctx);
  await running;
  resolve([{ status: 'committed' }]);
  await Promise.resolve();
  assert.deepEqual(f.messages, []);
  assert.ok(f.logs.some(([event]) => event === 'curator_cancelled'));
});

test('optional screening applies only to automatic curation and never overrides explicit saves', async () => {
  for (const [mode, text, expectedScreens, expectedCurations] of [
    ['auto', '你好', 1, 0],
    ['auto', '记住我', 0, 1],
    ['manual', '你好', 0, 0],
    ['manual', '记住我', 0, 1],
    ['off', '你好', 0, 0],
  ]) {
    let screens = 0;
    const f = fixture({}, false, async () => {
      screens++;
      return { skip: true, reason: 'JEV_NO_MEMORY_CANDIDATE' };
    });
    f.status.mode = mode;
    await run(f, 'stop', text);
    assert.equal(screens, expectedScreens);
    assert.equal(f.evaluations.length, expectedCurations);
  }
  const f = fixture({}, false, async () => ({ skip: false, reason: 'JEV_TIMEOUT' }));
  await run(f, 'stop', '我喜欢钓鱼');
  assert.equal(f.evaluations.length, 1);
});
