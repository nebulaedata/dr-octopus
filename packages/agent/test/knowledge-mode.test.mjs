/**
 * @author Codex
 * @description Exercises knowledge mode lifecycle, Session model ownership, workflow interoperability and collection enforcement.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { registerKnowledgeMode } from '../dist/extensions/knowledge/extension/mode.js';
import { scopeKnowledgeClient } from '../dist/extensions/knowledge/services/mode-policy.js';
import { modelToolNames } from '../dist/extensions/knowledge/definitions/model-tool-schemas.js';

/**
 * Model the public Pi surfaces with mutable model and branch identity for deterministic state transitions.
 */
function fixture() {
  const handlers = new Map();
  const commands = new Map();
  const entries = [];
  const events = new Map();
  const statuses = [];
  let active = ['read', 'bash', 'custom_tool', 'knowledge_search'];
  let model = { provider: 'local', id: 'base' };
  const ctx = {
    mode: 'rpc',
    hasUI: true,
    isIdle: () => true,
    hasPendingMessages: () => false,
    sessionManager: { getBranch: () => entries },
    get model() {
      return model;
    },
    modelRegistry: { find: (provider, id) => (id === 'missing' ? undefined : { provider, id }) },
    ui: { setStatus: (_key, value) => statuses.push(JSON.parse(value)), notify() {} },
  };
  const pi = {
    on: (name, handler) => handlers.set(name, handler),
    registerCommand: (name, command) => commands.set(name, command),
    appendEntry: (customType, data) =>
      entries.push({ type: 'custom', customType, data: structuredClone(data) }),
    getActiveTools: () => [...active],
    setActiveTools: (names) => {
      active = [...names];
    },
    setModel: async (next) => {
      model = next;
      await handlers.get('model_select')?.({ model, source: 'set' }, ctx);
      return true;
    },
    events: {
      on: (name, handler) => {
        const list = events.get(name) ?? [];
        list.push(handler);
        events.set(name, list);
      },
      emit: (name, data) => events.get(name)?.forEach((fn) => fn(data)),
    },
  };
  registerKnowledgeMode(pi);
  return {
    pi,
    ctx,
    entries,
    statuses,
    handlers,
    command: (value) => commands.get('knowledge').handler(value, ctx),
  };
}

test('ordinary session disables knowledge tools; switch preserves model/history and restores current tool snapshot', async () => {
  const f = fixture();
  await f.handlers.get('session_start')({}, f.ctx);
  assert.deepEqual(f.pi.getActiveTools(), ['read', 'bash', 'custom_tool']);
  assert.equal(f.handlers.get('before_agent_start')({}, f.ctx), undefined);
  await f.command('config {"collectionIds":["policies"]}');
  await f.command('on');
  assert.equal(f.ctx.model.id, 'base');
  assert.equal(f.pi.getActiveTools().length, 11);
  assert.ok(
    f.pi.getActiveTools().every((name) => name.startsWith('knowledge_') || modelToolNames.includes(name))
  );
  assert.match(f.handlers.get('before_agent_start')({}, f.ctx).systemPrompt, /policies/);
  assert.match(f.handlers.get('before_agent_start')({}, f.ctx).systemPrompt, /反问/);
  assert.equal(f.handlers.get('tool_call')({ toolName: 'bash' }).block, true);
  assert.equal(f.handlers.get('tool_call')({ toolName: 'knowledge_search' }), undefined);
  const attempt = { session: f.ctx.sessionManager, group: 'agent-workflow', busy: false };
  f.pi.events.emit('workflow:mutex:v1', attempt);
  assert.equal(attempt.busy, true);
  await f.command('off');
  assert.equal(f.ctx.model.id, 'base');
  assert.deepEqual(f.pi.getActiveTools(), ['read', 'bash', 'custom_tool']);
  assert.equal(f.statuses.at(-1).enabled, false);
  assert.ok(!('restoreTools' in f.statuses.at(-1)));
  assert.equal(f.handlers.get('tool_call')({ toolName: 'knowledge_search' }).block, true);
});

test('exited mode supplies current policy on every turn and restore, without replacing the base prompt', async () => {
  const f = fixture();
  await f.handlers.get('session_start')({}, f.ctx);
  await f.command('on');
  await f.command('off');
  const event = { systemPrompt: 'Current Agent policy' };
  for (const restore of [false, true]) {
    if (restore) {
      await f.handlers.get('session_start')({}, f.ctx);
    }
    for (let turn = 0; turn < 2; turn += 1) {
      const prompt = f.handlers.get('before_agent_start')(event, f.ctx).systemPrompt;
      assert.ok(prompt.startsWith(event.systemPrompt));
      assert.match(prompt, /知识问答模式已退出/);
      assert.match(prompt, /不要换工具或重试/);
      assert.ok(!f.pi.getActiveTools().some((name) => name.startsWith('knowledge_')));
      assert.equal(f.handlers.get('tool_call')({ toolName: 'read' }), undefined);
    }
  }
  await f.command('on');
  assert.doesNotMatch(
    f.handlers.get('before_agent_start')(event, f.ctx).systemPrompt,
    /Current Agent policy/
  );
  assert.ok(f.pi.getActiveTools().includes('knowledge_search'));
});

test('mode rejects running/queued/conflicting workflows without activation', async () => {
  for (const busy of ['running', 'queued', 'plan']) {
    const f = fixture();
    await f.handlers.get('session_start')({}, f.ctx);
    if (busy === 'running') {
      f.ctx.isIdle = () => false;
    }
    if (busy === 'queued') {
      f.ctx.hasPendingMessages = () => true;
    }
    if (busy === 'plan') {
      f.pi.events.on('workflow:mutex:v1', (attempt) => {
        attempt.busy = true;
      });
    }
    await assert.rejects(f.command('on'));
    assert.equal(f.statuses.at(-1).enabled, false);
  }
});

test('source changes, reload, branch restore and mode switches preserve the selected Session model', async () => {
  const f = fixture();
  await f.handlers.get('session_start')({}, f.ctx);
  await f.command('on');
  await f.pi.setModel({ provider: 'local', id: 'answer' });
  await f.command('config {"collectionIds":["selected"]}');
  assert.equal(f.ctx.model.id, 'answer');
  for (const event of ['session_start', 'session_tree']) {
    await f.handlers.get(event)({}, f.ctx);
    assert.equal(f.ctx.model.id, 'answer');
    assert.equal(f.statuses.at(-1).enabled, true);
    assert.deepEqual(f.statuses.at(-1).collectionIds, ['selected']);
  }
  await f.command('off');
  assert.equal(f.ctx.model.id, 'answer');
  await f.command('on');
  assert.equal(f.ctx.model.id, 'answer');
  await f.command('off');
  await f.pi.setModel({ provider: 'local', id: 'base' });
  await f.command('on');
  assert.equal(f.ctx.model.id, 'base');
});

test('standalone model tools survive ordinary turns and knowledge-mode restore', async () => {
  const f = fixture();
  f.pi.setActiveTools(['read', 'knowledge_search', ...modelToolNames]);
  await f.handlers.get('session_start')({}, f.ctx);
  for (const name of modelToolNames) {
    assert.ok(f.pi.getActiveTools().includes(name));
    assert.equal(f.handlers.get('tool_call')({ toolName: name }), undefined);
  }
  f.pi.appendEntry('octopus-knowledge-mode', {
    version: 1,
    enabled: true,
    collectionIds: [],
    restoreTools: ['read', ...modelToolNames],
  });
  await f.handlers.get('session_start')({}, f.ctx);
  for (const name of modelToolNames) {
    assert.equal(f.handlers.get('tool_call')({ toolName: name }), undefined);
  }
  await f.command('off');
  assert.deepEqual(f.pi.getActiveTools(), ['read', ...modelToolNames]);
  assert.match(
    f.handlers.get('before_agent_start')({ systemPrompt: 'base' }, f.ctx).systemPrompt,
    /仍可独立使用/
  );
  await f.handlers.get('session_shutdown')({}, f.ctx);
  await f.handlers.get('session_start')({}, f.ctx);
  assert.deepEqual(f.pi.getActiveTools(), ['read', ...modelToolNames]);
});

test('selected sources fence list/search/import/read/job and deny collection creation', async () => {
  const calls = [];
  const base = {
    upload: async () => ({}),
    call: async (operation, input) => {
      calls.push([operation, input]);
      if (operation === 'collections.get') {
        return { id: input.id };
      }
      if (operation === 'read') {
        return { collectionId: 'outside', text: 'must not leak' };
      }
      if (operation === 'jobs.get') {
        return { job: { collectionId: 'outside' } };
      }
      return { hits: [] };
    },
  };
  const client = scopeKnowledgeClient(base, () => ['selected']);
  assert.deepEqual((await client.call('collections.list', {})).items, [{ id: 'selected' }]);
  for (const [operation, input] of [
    ['search', { collectionIds: ['outside'] }],
    ['jobs.import', { collectionId: 'outside' }],
    ['collections.create', {}],
  ]) {
    const count = calls.length;
    await assert.rejects(client.call(operation, input), /范围/);
    assert.equal(calls.length, count);
  }
  await assert.rejects(client.call('read', { citationId: 'old' }), /选定集合/);
  await assert.rejects(client.call('jobs.get', { id: 'old' }), /选定集合/);
  await client.call('search', { collectionIds: ['selected'], query: 'q' });
  await scopeKnowledgeClient(base, () => []).call('search', { collectionIds: ['visible'], query: 'q' });
});
