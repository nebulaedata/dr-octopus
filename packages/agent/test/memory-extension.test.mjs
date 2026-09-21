/**
 * @author Codex
 * @description Verify memory through public Pi loading, TUI/RPC adapters and cancellation without external model calls.
 */
import assert from 'node:assert/strict';
import { stopMemoryService, startMemoryService } from '../dist/extensions/memory/sdk/lifecycle.js';
import test from 'node:test';
import { mkdtemp, rm, access, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent';
import { createMemoryExtension } from '../dist/extensions/memory/index.js';
import { createMemoryService } from '../dist/extensions/memory/sdk/index.js';
import { publishMemoryStatus } from '../dist/extensions/memory/extension/ui.js';
/**
 * Build a real storage fixture behind minimal public Extension API surfaces.
 */
async function fixture(t, mode = 'rpc', options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'memory-extension-'));
  const events = new Map(),
    tools = new Map(),
    commands = new Map(),
    messages = [],
    statuses = [],
    branch = [];
  const pi = {
    on: (name, fn) => events.set(name, fn),
    registerTool: (tool) => tools.set(tool.name, tool),
    registerCommand: (name, command) => commands.set(name, command),
    getActiveTools: () => [...tools.keys()],
    sendMessage: (message, options) => messages.push({ message, options }),
  };
  createMemoryExtension({ dataRoot: root, ...options })(pi);
  const start = events.get('session_start');
  events.set('session_start', async (...args) => {
    const count = statuses.length;
    start(...args);
    const deadline = Date.now() + 30000;
    while (statuses.length === count && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(statuses.length > count, 'Memory initialization did not publish status');
  });
  const ctx = {
    mode,
    hasUI: true,
    isProjectTrusted: () => true,
    ui: {
      theme: { fg: (color, text) => `<${color}>${text}</${color}>` },
      setStatus: (key, text) => statuses.push({ key, text }),
      custom: () => assert.fail('RPC cannot use terminal custom UI'),
    },
    sessionManager: { getBranch: () => branch, getSessionId: () => 'session' },
  };
  t.after(async () => {
    await events.get('session_shutdown')({}, ctx);
    await events.get('session_shutdown')({}, ctx);
    await stopMemoryService(root);
    await rm(root, { recursive: true, force: true });
  });
  return { root, events, tools, commands, messages, statuses, branch, ctx, pi };
}
test('built factory loads with actual Pi resource loader and bundled skill/migrations', async (t) => {
  const { root } = await fixture(t);
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir: join(root, 'agent'),
    settingsManager: SettingsManager.inMemory({ packages: [] }),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    extensionFactories: [
      { name: 'octopus-memory', hidden: true, factory: createMemoryExtension({ dataRoot: root }) },
    ],
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const extension = loader.getExtensions().extensions.find((ext) => ext.tools.has('memory_recall'));
  assert.ok(extension);
  assert.ok(extension.commands.has('memory'));
  assert.equal(extension.tools.size, 2);
  assert.equal(extension.handlers.has('resources_discover'), false);
  await access(new URL('../dist/assets/memory-migrations/meta/_journal.json', import.meta.url));
  await access(new URL('../dist/extensions/memory/skills/memory/SKILL.md', import.meta.url));
});
for (const mode of ['tui', 'rpc'])
  test(mode + ' injects the full built-in memory skill on every run without a model file read', async (t) => {
    const { events, ctx, messages, pi } = await fixture(t, mode);
    ctx.hasUI = false;
    await events.get('session_start')({}, ctx);
    const skill = await readFile(
      new URL('../dist/extensions/memory/skills/memory/SKILL.md', import.meta.url),
      'utf8'
    );
    const body = skill.split('---').slice(2).join('---').trim();
    assert.ok(body.length > 0);
    const event = { systemPrompt: 'Existing Agent and extension policies.' };
    for (let run = 0; run < 2; run++) {
      const result = await events.get('before_agent_start')(event, ctx);
      assert.ok(result.systemPrompt.startsWith(event.systemPrompt + '\n\n'));
      assert.ok(result.systemPrompt.trimEnd().endsWith(body));
      assert.match(result.systemPrompt, /at most twice/);
      assert.match(result.systemPrompt, /Acknowledge memory requests without claiming persistence/);
      assert.doesNotMatch(result.systemPrompt, /name: memory|SKILL\.md/);
      assert.equal(result.message, undefined);
    }
    assert.deepEqual(messages, []);
    for (const activeTools of [[], ['memory_read'], ['memory_recall']]) {
      pi.getActiveTools = () => activeTools;
      assert.equal(await events.get('before_agent_start')(event, ctx), undefined);
    }
  });
for (const mode of ['tui', 'rpc'])
  test(mode + ' completes remember/read/forget without a Server or model', async (t) => {
    const { events, commands, tools, messages, statuses, ctx } = await fixture(t, mode);
    await events.get('session_start')({}, ctx);
    await commands.get('memory').handler('remember Prefer concise Chinese replies', ctx);
    const created = JSON.parse(messages.at(-1).message.content);
    assert.equal(created.status, 'committed');
    assert.equal(messages.at(-1).options.triggerTurn, false);
    const read = await tools
      .get('memory_read')
      .execute('id', { refs: [created.ref] }, new AbortController().signal);
    assert.equal(read.details.items[0].document.bodyMd, 'Prefer concise Chinese replies');
    await commands.get('memory').handler('forget ' + created.ref.storeId + '/' + created.ref.indexId, ctx);
    assert.equal(JSON.parse(messages.at(-1).message.content).action, 'forget');
    const context = await events.get('context')(
      {
        messages: [
          {
            role: 'toolResult',
            toolName: 'memory_read',
            toolCallId: 'id',
            details: read.details,
            content: read.content,
            timestamp: Date.now(),
          },
        ],
      },
      ctx
    );
    assert.ok(context.messages[0].content[0].text.includes('已删除'));
    assert.equal(context.messages.filter((m) => m.customType === 'octopus-memory-context').length, 1);
    const again = await events.get('context')(context, ctx);
    assert.equal(again.messages.filter((m) => m.customType === 'octopus-memory-context').length, 1);
    if (mode === 'rpc') assert.equal(JSON.parse(statuses.at(-1).text).version, 1);
    else assert.ok(statuses.at(-1).text.startsWith('<dim>memory'));
  });
test('memory status uses the current theme dim token while RPC stays unstyled', () => {
  const statuses = [];
  const calls = [];
  const ctx = {
    mode: 'tui',
    ui: {
      theme: {
        fg: (color, text) => {
          calls.push(color);
          return `light:${text}`;
        },
      },
      setStatus: (_key, text) => statuses.push(text),
    },
  };
  const status = { version: 1, mode: 'auto', revision: 0, writeEpoch: 0, count: 0, availability: 'ready' };
  publishMemoryStatus(ctx, status);
  assert.equal(statuses.at(-1), 'light:memory · auto');
  ctx.ui.theme = {
    fg: (color, text) => {
      calls.push(color);
      return `dark:${text}`;
    },
  };
  publishMemoryStatus(ctx, status, 'running');
  assert.equal(statuses.at(-1), 'dark:memory · auto · curating');
  publishMemoryStatus(ctx, { ...status, availability: 'unavailable' });
  assert.equal(statuses.at(-1), 'dark:memory · store unavailable');
  ctx.mode = 'rpc';
  publishMemoryStatus(ctx, status);
  assert.equal(JSON.parse(statuses.at(-1)).availability, 'ready');
  assert.deepEqual(calls, ['dim', 'dim', 'dim']);
});

test('store failure keeps the last healthy mode, says store unavailable, and recovers on next observation', async (t) => {
  const { root, events, statuses, ctx } = await fixture(t, 'tui');
  await events.get('session_start')({}, ctx);
  assert.equal(statuses.at(-1).text, '<dim>memory · auto</dim>');
  await stopMemoryService(root);
  try {
    await events.get('context')({ messages: [] }, ctx);
    assert.equal(statuses.at(-1).text, '<dim>memory · store unavailable</dim>');
    ctx.mode = 'rpc';
    await events.get('context')({ messages: [] }, ctx);
    const failed = JSON.parse(statuses.at(-1).text);
    assert.equal(failed.availability, 'unavailable');
    assert.equal(failed.mode, 'auto');
    assert.equal(failed.curator, 'idle');
    assert.equal(failed.errorCode, 'STORE_UNAVAILABLE');
    ctx.mode = 'tui';
  } finally {
    await startMemoryService(root);
  }
  await events.get('context')({ messages: [] }, ctx);
  assert.equal(statuses.at(-1).text, '<dim>memory · auto</dim>');
  assert.equal((await events.get('context')({ messages: [] }, ctx)).messages.length, 1);
  const logEntries = (await readFile(join(root, 'memory', 'extension.log'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    logEntries.map((entry) => entry.event),
    ['context_failed', 'context_failed', 'recovered']
  );
  assert.equal(logEntries[0].code, 'MEMORY_SERVICE_STOPPED');
  assert.ok(logEntries[0].message);
});
test('tool budgets and mode restrictions are enforced even for parallel calls', async (t) => {
  const { events, ctx, tools, pi } = await fixture(t);
  await events.get('session_start')({}, ctx);
  const tool = tools.get('memory_recall');
  const results = await Promise.allSettled(
    Array.from({ length: 4 }, () =>
      tool.execute('id', { mode: 'search', query: 'test' }, new AbortController().signal)
    )
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 2);
  assert.equal(
    results.filter((r) => r.status === 'rejected' && r.reason.code === 'BUDGET_EXHAUSTED').length,
    2
  );
  await events.get('before_agent_start')({ systemPrompt: 'base' }, ctx);
  pi.getActiveTools = () => [];
  await assert.rejects(
    tools
      .get('memory_read')
      .execute('id', { refs: [{ storeId: 'none', indexId: 1 }] }, new AbortController().signal),
    { code: 'READ_ONLY' }
  );
  assert.equal((await events.get('context')({ messages: [] }, ctx)).messages.length, 0);
});

test('recall has a provider-compatible object schema and enforces mode-specific inputs', async (t) => {
  const { events, ctx, tools, root } = await fixture(t);
  await events.get('session_start')({}, ctx);
  for (const tool of tools.values()) {
    const schema = JSON.parse(JSON.stringify(tool.parameters));
    assert.equal(schema.type, 'object');
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.anyOf, undefined);
    assert.equal(schema.oneOf, undefined);
  }
  const tool = tools.get('memory_recall');
  for (const input of [{ mode: 'search', query: 'history' }, { mode: 'page' }]) {
    const result = await tool.execute('id', input, new AbortController().signal);
    assert.deepEqual(result.details.items, []);
  }
  for (const input of [
    { mode: 'search' },
    { mode: 'search', query: 'history', cursor: 'unexpected' },
    { mode: 'page', query: 'unexpected' },
    { mode: 'page', extra: true },
  ]) {
    await events.get('before_agent_start')({ systemPrompt: 'base' }, ctx);
    await assert.rejects(tool.execute('id', input, new AbortController().signal), {
      code: 'INVALID_INPUT',
    });
  }
  const service = createMemoryService({ dataRoot: root });
  try {
    const status = await service.getStatus();
    await service.setPolicy({ requestId: 'off', mode: 'off', expectedRevision: status.revision });
    await assert.rejects(tool.execute('id', { mode: 'page' }, new AbortController().signal), {
      code: 'READ_ONLY',
    });
    assert.equal((await events.get('context')({ messages: [] }, ctx)).messages.length, 0);
  } finally {
    await service.dispose();
  }
});
test('new user evidence is curated only once after success, and switching cancels late providers', async (t) => {
  const { root, events, ctx, branch } = await fixture(t);
  await events.get('session_start')({}, ctx);
  let finish;
  ctx.model = { id: 'fake' };
  ctx.modelRegistry = {
    complete: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  };
  await events.get('before_agent_start')({ systemPrompt: 'base' }, ctx);
  branch.push({
    id: 'user-1',
    type: 'message',
    message: { role: 'user', content: 'Remember this: always use Chinese' },
  });
  events.get('agent_end')({ messages: [{ role: 'assistant', stopReason: 'stop' }] });
  const settling = events.get('agent_settled')({}, ctx);
  for (let i = 0; i < 100 && !finish; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(finish);
  events.get('session_before_switch')({}, ctx);
  await settling;
  finish({
    stopReason: 'stop',
    content: [
      {
        type: 'text',
        text: JSON.stringify([
          {
            requestId: 'late',
            action: 'create',
            canonicalKey: 'language',
            topic: 'Preferences',
            type: 'preference',
            indexText: 'Chinese',
            bodyMd: 'Chinese',
            sources: [{ sessionId: 'session', entryId: 'user-1', evidence: 'Chinese' }],
          },
        ]),
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const service = createMemoryService({ dataRoot: root });
  assert.equal((await service.getStatus()).count, 0);
  await service.dispose();
});
