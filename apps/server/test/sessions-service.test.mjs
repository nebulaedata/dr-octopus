/**
 * @author Codex
 * @description Verifies SessionsService realtime event enrichment with durable message metadata.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { SettingsService } from '../dist/modules/model-settings/index.js';
import { createSessionsService } from '../dist/modules/sessions/index.js';
import { projectHostVisibleUserMessage } from '../dist/modules/sessions/sessions.service.js';

/**
 * Builds a SessionsService with injectable doubles for entryId-enrichment tests.
 */
function createService(options = {}) {
  const server = Fastify();
  let runtimeListener;
  const runtime = {
    onEvent: (listener) => {
      runtimeListener = listener;
      return () => {
        runtimeListener = undefined;
      };
    },
    getBindingBySessionId: () => undefined,
    stop: async () => undefined,
    ...options.runtime,
  };
  const sessionsRepository = {
    getRow: options.getRow ?? (() => undefined),
    get: options.get ?? (() => undefined),
    list: options.list ?? (() => []),
    upsert: options.upsert ?? ((row) => row),
    delete: options.delete ?? (() => true),
    touch: options.touch ?? (() => undefined),
    recordLastMessageAt: options.recordLastMessageAt ?? (() => undefined),
    rename: options.rename ?? ((sessionId, title) => ({ title })),
    setPinned: options.setPinned ?? ((sessionId, pinned) => ({ pinned })),
    updateModel: options.updateModel ?? ((sessionId, provider, model) => ({ provider, model })),
    updatePreferences: options.updatePreferences ?? ((sessionId, preferences) => preferences),
  };
  const messageFeedbackRepository = {
    upsert: options.upsertFeedback ?? (() => ({ entryId: '', rating: 'up' })),
    listBySession: options.listFeedback ?? (() => []),
  };
  const piSessionsRepository = {
    getEntries: options.getEntries ?? (() => ({ entries: [], leafId: null })),
    getTree: options.getTree ?? (() => ({ tree: [], leafId: null })),
    derive: options.derive ?? (() => ({ sessionId: 'derived', path: '/tmp/derived.jsonl' })),
    delete: options.deleteSessionFiles ?? (() => undefined),
    readMetadata: options.readMetadata ?? (() => ({ sessionId: 'agent-session', cwd: '/tmp' })),
  };

  const service = createSessionsService(server, {
    workspaceService: { resolve: async () => ({ id: 'workspace-a', cwd: '/tmp' }) },
    runtime,
    sessionsRepository,
    messageFeedbackRepository,
    piSessionsRepository,
    modelSettings: options.modelSettings,
  });

  return { service, emit: (event) => runtimeListener?.(event) };
}

test('session model lists and switches honor the Host chat candidate catalog', async (t) => {
  const commands = [];
  const models = ['chat', 'image', 'both', 'other'].map((id) => ({ provider: 'custom', id, name: id }));
  const { service } = createService({
    getRow: () => ({ id: 'session-a', workspaceId: 'workspace-a', agentSessionPath: '/tmp/session-a.jsonl' }),
    modelSettings: new SettingsService({
      listProviders: async () => [
        {
          id: 'custom',
          models: [
            { id: 'chat', interfaces: ['chat'] },
            { id: 'image', interfaces: ['image'] },
            { id: 'both', interfaces: ['chat', 'image'] },
            { id: 'other', interfaces: ['other'] },
          ],
        },
      ],
    }),
    runtime: {
      withExisting: async (_request, operation) =>
        operation({
          binding: { runtimeId: 'runtime-a', epoch: 1 },
          execute: async (command) => {
            commands.push(command);
            return { success: true, data: { models } };
          },
        }),
    },
  });
  t.after(() => service.dispose());
  assert.deepEqual(
    (await service.getModels('session-a')).map((model) => model.id),
    ['chat', 'both']
  );
  const command = { type: 'set_model', provider: 'custom', modelId: 'image' };
  await assert.rejects(service.executeThinkingControl('session-a', command), {
    code: 'CONVERSATION_MODEL_REQUIRED',
  });
  await assert.rejects(service.execute('session-a', command), { code: 'CONVERSATION_MODEL_REQUIRED' });
  await assert.rejects(service.executeThinkingControl('session-a', { ...command, modelId: 'other' }), {
    code: 'CONVERSATION_MODEL_REQUIRED',
  });
  await assert.rejects(service.execute('session-a', { ...command, modelId: 'other' }), {
    code: 'CONVERSATION_MODEL_REQUIRED',
  });
  assert.equal(
    commands.some((item) => item.type === 'set_model'),
    false
  );
});

test('runtime-only models remain selectable through both model-switch entrypoints', async (t) => {
  const models = [
    { provider: 'extension', id: 'chat', name: 'Extension chat' },
    { provider: 'custom', id: 'runtime-auth', name: 'Runtime authenticated chat' },
  ];
  const commands = [];
  const { service } = createService({
    getRow: () => ({ id: 'session-a', workspaceId: 'workspace-a', agentSessionPath: '/tmp/session-a.jsonl' }),
    modelSettings: new SettingsService({
      listProviders: async () => [
        {
          id: 'custom',
          models: [{ id: 'runtime-auth', available: false }],
        },
      ],
    }),
    runtime: {
      withExisting: async (_request, operation) =>
        operation({
          binding: { runtimeId: 'runtime-a', epoch: 1 },
          execute: async (command) => {
            commands.push(command);
            if (command.type === 'get_available_models') {
              return { success: true, data: { models } };
            }
            if (command.type === 'get_available_thinking_levels') {
              return { success: true, data: { levels: ['off'] } };
            }
            return { success: true, data: { model: models[0], thinkingLevel: 'off' } };
          },
        }),
    },
  });
  t.after(() => service.dispose());
  assert.deepEqual(
    await service.getModels('session-a'),
    models.map((model) => ({ ...model, reasoning: false, input: ['text'] }))
  );
  for (const model of models) {
    const command = { type: 'set_model', provider: model.provider, modelId: model.id };
    await service.execute('session-a', command);
    await service.executeThinkingControl('session-a', command);
    assert.equal(commands.filter((item) => item.type === 'set_model' && item.modelId === model.id).length, 2);
  }
});

/**
 * Drains queued microtasks so deferred event enrichment can complete.
 */
async function drainMicrotasks() {
  await new Promise((resolve) => queueMicrotask(resolve));
}

test('message_end event is enriched with matching Pi persistence metadata', async () => {
  const timestamp = Date.now();
  const entries = [
    {
      type: 'message',
      id: 'entry-user-a',
      parentId: null,
      timestamp: new Date(timestamp).toISOString(),
      message: { role: 'user', content: 'hello', timestamp },
    },
  ];

  const { service, emit } = createService({
    getRow: () => ({ agentSessionPath: '/tmp/session-a.jsonl' }),
    getEntries: () => ({ entries, leafId: 'entry-user-a' }),
  });

  const received = [];
  service.onEvent((event) => received.push(event));

  emit({
    type: 'agent-event',
    runtimeId: 'runtime-a',
    epoch: 1,
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    sequence: 1,
    timestamp: new Date().toISOString(),
    payload: {
      type: 'message_end',
      message: { role: 'user', content: 'hello', timestamp },
    },
  });

  await drainMicrotasks();

  assert.equal(received.length, 1);
  assert.equal(received[0].payload.type, 'message_end');
  assert.equal(received[0].payload.message.entryId, 'entry-user-a');
  assert.equal(received[0].payload.message.persistedAt, entries[0].timestamp);
});

test('non-message events are delivered synchronously without enrichment', () => {
  const { service, emit } = createService({
    getRow: () => ({ agentSessionPath: '/tmp/session-a.jsonl' }),
  });

  const received = [];
  service.onEvent((event) => received.push(event));

  emit({
    type: 'runtime-state',
    runtimeId: 'runtime-a',
    epoch: 1,
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    sequence: 1,
    timestamp: new Date().toISOString(),
    payload: { state: 'running' },
  });

  assert.equal(received.length, 1);
  assert.equal(received[0].payload.state, 'running');
});

test('events after deferred message persistence retain runtime sequence order', async () => {
  const timestamp = Date.now();
  const { service, emit } = createService({
    getRow: () => ({ agentSessionPath: '/tmp/session-a.jsonl' }),
    getEntries: () => ({ entries: [], leafId: null }),
  });
  const received = [];
  service.onEvent((event) => received.push(event));

  emit({
    type: 'agent-event',
    runtimeId: 'runtime-a',
    epoch: 1,
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    sequence: 1,
    timestamp: new Date(timestamp).toISOString(),
    payload: {
      type: 'message_end',
      message: { role: 'assistant', content: [{ type: 'text', text: 'done' }], timestamp },
    },
  });
  emit({
    type: 'runtime-state',
    runtimeId: 'runtime-a',
    epoch: 1,
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    sequence: 2,
    timestamp: new Date(timestamp + 1).toISOString(),
    payload: { state: 'idle' },
  });
  emit({
    type: 'agent-event',
    runtimeId: 'runtime-a',
    epoch: 1,
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    sequence: 3,
    timestamp: new Date(timestamp + 2).toISOString(),
    payload: { type: 'agent_settled' },
  });

  assert.deepEqual(received, []);
  await drainMicrotasks();
  assert.deepEqual(
    received.map((event) => [event.sequence, event.type, event.payload.type ?? event.payload.state]),
    [
      [1, 'agent.event', 'message_end'],
      [2, 'agent.state', 'idle'],
      [3, 'agent.event', 'agent_settled'],
    ]
  );
});

test('message event is unchanged when no matching entry exists', async () => {
  const timestamp = Date.now();

  const { service, emit } = createService({
    getRow: () => ({ agentSessionPath: '/tmp/session-a.jsonl' }),
    getEntries: () => ({ entries: [], leafId: null }),
  });

  const received = [];
  service.onEvent((event) => received.push(event));

  emit({
    type: 'agent-event',
    runtimeId: 'runtime-a',
    epoch: 1,
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    sequence: 1,
    timestamp: new Date().toISOString(),
    payload: {
      type: 'message_end',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }], timestamp },
    },
  });

  await drainMicrotasks();

  assert.equal(received.length, 1);
  assert.equal(received[0].payload.message.entryId, undefined);
});

test('Host message projection preserves user text while hiding private attachment adaptation', () => {
  const projected = projectHostVisibleUserMessage(
    {
      role: 'user',
      content: [
        { type: 'image', data: 'private-base64', mimeType: 'image/png' },
        {
          type: 'text',
          text: 'Visible prompt\n<host_attachment_request id="request-a" />\n<host_attachment_policy>private</host_attachment_policy>',
        },
      ],
    },
    true
  );

  assert.deepEqual(projected, {
    role: 'user',
    content: [{ type: 'text', text: 'Visible prompt' }],
  });
});

test('Host message projection hides private Workspace reference context', () => {
  const projected = projectHostVisibleUserMessage({
    role: 'user',
    content:
      'Read @src/config.ts\n<host_workspace_reference_request id="request-b" />\n<host_workspace_references version="1"><reference kind="file" path="src/config.ts" /></host_workspace_references>',
  });

  assert.deepEqual(projected, {
    role: 'user',
    content: 'Read @src/config.ts',
  });
});

test('Workspace reference context does not claim ownership of unrelated Pi image blocks', () => {
  const projected = projectHostVisibleUserMessage({
    role: 'user',
    content: [
      { type: 'image', data: 'pi-owned-image', mimeType: 'image/png' },
      {
        type: 'text',
        text: 'Read @src/config.ts\n<host_workspace_reference_request id="request-c" />\n<host_workspace_references version="1" />',
      },
    ],
  });

  assert.deepEqual(projected, {
    role: 'user',
    content: [
      { type: 'image', data: 'pi-owned-image', mimeType: 'image/png' },
      { type: 'text', text: 'Read @src/config.ts' },
    ],
  });
});
