/**
 * @author Codex
 * @description Verifies fresh Session loading and subscription retention across navigation races.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionRuntimeRegistry } from '../src/lib/runtime/session-runtime-registry.ts';
import { createSessionStore } from '../src/stores/session/store.ts';
import { getLastItemIndexByTurn } from '../src/features/session/turn-transcript-model.ts';

/**
 * Creates a deterministic subscription adapter that records desired transitions.
 */
function createSubscriptionAdapter() {
  const subscribed = new Set();
  const transitions = [];
  return {
    subscribed,
    transitions,
    subscribeSession(sessionId) {
      if (!subscribed.has(sessionId)) {
        subscribed.add(sessionId);
        transitions.push(`subscribe:${sessionId}`);
      }
    },
    unsubscribeSession(sessionId) {
      if (subscribed.delete(sessionId)) {
        transitions.push(`unsubscribe:${sessionId}`);
      }
    },
  };
}

/**
 * Creates a minimal authoritative snapshot for projection tests.
 */
function createSnapshot({ sequence = 0, state = 'idle' } = {}) {
  return {
    session: {
      id: 'session-a',
      workspaceId: 'workspace-a',
      title: 'Session A',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      preferences: {
        steeringMode: 'one-at-a-time',
        followUpMode: 'one-at-a-time',
        autoCompactionEnabled: true,
        autoRetryEnabled: true,
      },
    },
    thinking: {
      level: 'medium',
      availableLevels: ['off', 'low', 'medium', 'high'],
    },
    permission: { mode: 'full', scope: 'runtime-generation', persisted: false },
    runtime: {
      runtimeId: 'runtime-a',
      epoch: 1,
      workspaceId: 'workspace-a',
      sessionId: 'session-a',
      state,
      lastActiveAt: 0,
    },
    sequence,
    messages: [],
    pendingExtensionUi: [],
    planMode: { available: true, workMode: 'agent', phase: 'off', awaitingAction: false },
  };
}

test('stop commands retain error correlation after main idle until the server confirms background stop', () => {
  const adapter = createSubscriptionAdapter();
  const registry = new SessionRuntimeRegistry(adapter);
  try {
    registry.retainCommand('session-a', 'stop-a', 0, true);
    registry.observe({
      type: 'agent.state',
      sessionId: 'session-a',
      sequence: 1,
      payload: { state: 'idle' },
    });
    assert.equal(adapter.subscribed.has('session-a'), true);
    assert.deepEqual(
      registry.observe({ type: 'error', requestId: 'stop-a', message: 'Background stop timed out' }),
      {
        sessionId: 'session-a',
        requestId: 'stop-a',
        message: 'Background stop timed out',
      }
    );
    assert.equal(adapter.subscribed.has('session-a'), false);
  } finally {
    registry.dispose();
  }
});

test('fresh bootstrap clears stale authoritative projection while preserving the browser draft', () => {
  const store = createSessionStore('session-a');
  store.getState().hydrate({
    session: {
      id: 'session-a',
      workspaceId: 'workspace-a',
      title: 'Session A',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      preferences: {
        steeringMode: 'one-at-a-time',
        followUpMode: 'one-at-a-time',
        autoCompactionEnabled: true,
        autoRetryEnabled: true,
      },
    },
    thinking: {
      level: 'medium',
      availableLevels: ['off', 'low', 'medium', 'high'],
    },
    runtime: {
      runtimeId: 'runtime-old',
      epoch: 1,
      workspaceId: 'workspace-a',
      sessionId: 'session-a',
      state: 'idle',
      lastActiveAt: 0,
    },
    sequence: 3,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'stale' }] }],
    pendingExtensionUi: [],
    planMode: { available: true, workMode: 'agent', phase: 'off', awaitingAction: false },
  });
  store.getState().setDraft('preserve me');

  store.getState().beginBootstrap();

  const state = store.getState();
  assert.equal(state.loadState, 'loading');
  assert.equal(state.hydrated, false);
  assert.deepEqual(state.messageIds, []);
  assert.equal(state.runtimeId, undefined);
  assert.equal(state.draft, 'preserve me');
});

test('authoritative Plan events project state while the matching acknowledgement settles the mutation', () => {
  const store = createSessionStore('session-a');
  store.getState().hydrate(createSnapshot({ sequence: 1 }));
  store.getState().beginWorkModeChange('request-plan', 'plan');

  store.getState().applyEvent({
    type: 'extension.ui',
    runtimeId: 'runtime-a',
    epoch: 1,
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    sequence: 2,
    timestamp: '2026-01-01T00:00:01.000Z',
    payload: { method: 'setStatus', statusKey: 'plan-mode' },
    planMode: { available: true, workMode: 'plan', phase: 'planning', awaitingAction: false },
  });

  assert.equal(store.getState().pendingWorkMode.requestId, 'request-plan');
  store.getState().setPlanMode(store.getState().planMode, 'request-plan');
  assert.equal(store.getState().pendingWorkMode, undefined);
  assert.equal(store.getState().planMode.workMode, 'plan');
});

test('hidden Pi custom messages stay out of hydrated and live transcripts', () => {
  const hiddenContract = {
    role: 'custom',
    customType: 'plan-mode-transition',
    content: '[PI PLAN MODE CONTRACT v1: NORMAL]',
    display: false,
    timestamp: 1,
  };
  const store = createSessionStore('session-a');
  store.getState().hydrate({
    ...createSnapshot({ sequence: 1 }),
    messages: [
      hiddenContract,
      { role: 'assistant', content: [{ type: 'text', text: 'Visible response' }], timestamp: 2 },
    ],
  });

  assert.deepEqual(
    store.getState().messageIds.map((id) => store.getState().messagesById[id].role),
    ['assistant']
  );
  assert.equal(store.getState().transcriptItems.length, 1);

  for (const [sequence, type] of [
    [2, 'message_start'],
    [3, 'message_end'],
  ]) {
    store.getState().applyEvent({
      type: 'agent.event',
      runtimeId: 'runtime-a',
      epoch: 1,
      workspaceId: 'workspace-a',
      sessionId: 'session-a',
      sequence,
      timestamp: `2026-01-01T00:00:0${String(sequence)}.000Z`,
      payload: { type, message: { ...hiddenContract, timestamp: sequence } },
    });
  }

  assert.equal(store.getState().messageIds.length, 1);
  assert.equal(store.getState().transcriptItems.length, 1);
});

test('Pi thinking events replace the effective level without widening model capabilities', () => {
  const store = createSessionStore('session-a');
  store.getState().hydrate(createSnapshot({ sequence: 1 }));

  store.getState().applyEvent({
    type: 'agent.event',
    runtimeId: 'runtime-a',
    epoch: 1,
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    sequence: 2,
    timestamp: '2026-01-01T00:00:01.000Z',
    payload: { type: 'thinking_level_changed', level: 'high' },
  });

  assert.deepEqual(store.getState().thinking, {
    level: 'high',
    availableLevels: ['off', 'low', 'medium', 'high'],
  });
});

test('Pi extension errors reach the existing Session error Alert projection', () => {
  const store = createSessionStore('session-a');
  store.getState().hydrate(createSnapshot({ sequence: 1 }));

  store.getState().applyEvent({
    type: 'agent.event',
    runtimeId: 'runtime-a',
    epoch: 1,
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    sequence: 2,
    timestamp: '2026-01-01T00:00:01.000Z',
    payload: {
      type: 'extension_error',
      extensionPath: 'command:permission-mode',
      event: 'command',
      error: 'Unable to change permission mode.',
    },
  });

  assert.equal(
    store.getState().error,
    'Extension command "/permission-mode" failed: Unable to change permission mode.'
  );
});

test('runtime recovery resets permission mode and clears process-owned dialogs', () => {
  const store = createSessionStore('session-a');
  store.getState().hydrate(createSnapshot({ sequence: 1 }));
  store.setState({
    pendingExtensionUi: [
      {
        type: 'extension.ui',
        runtimeId: 'runtime-a',
        epoch: 1,
        workspaceId: 'workspace-a',
        sessionId: 'session-a',
        sequence: 1,
        timestamp: '2026-01-01T00:00:00.000Z',
        payload: { method: 'confirm', id: 'stale-confirmation' },
      },
    ],
  });

  store.getState().applyEvent({
    type: 'agent.state',
    runtimeId: 'runtime-a',
    epoch: 1,
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    sequence: 2,
    timestamp: '2026-01-01T00:00:01.000Z',
    payload: { state: 'recovering' },
  });

  assert.equal(store.getState().permission.mode, 'ask');
  assert.deepEqual(store.getState().pendingExtensionUi, []);
});

test('pending command retains a Session when its view closes before running is observed', () => {
  const adapter = createSubscriptionAdapter();
  const registry = new SessionRuntimeRegistry(adapter, { commandRetentionMs: 60_000 });
  const closeView = registry.openView('session-a');
  registry.retainCommand('session-a', 'request-a', 5);

  closeView();

  assert.equal(adapter.subscribed.has('session-a'), true);
  registry.observe({
    type: 'agent.state',
    runtimeId: 'runtime-a',
    epoch: 1,
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    sequence: 6,
    timestamp: '2026-01-01T00:00:00.000Z',
    payload: { state: 'running' },
  });
  assert.equal(adapter.subscribed.has('session-a'), true);
  registry.observe({
    type: 'agent.state',
    runtimeId: 'runtime-a',
    epoch: 1,
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    sequence: 7,
    timestamp: '2026-01-01T00:00:01.000Z',
    payload: { state: 'idle' },
  });

  assert.equal(adapter.subscribed.has('session-a'), false);
  assert.deepEqual(adapter.transitions, ['subscribe:session-a', 'unsubscribe:session-a']);
  registry.dispose();
});

test('a correlated command error releases background retention', () => {
  const adapter = createSubscriptionAdapter();
  const registry = new SessionRuntimeRegistry(adapter, { commandRetentionMs: 60_000 });
  registry.retainCommand('session-a', 'request-a', 0);

  const failure = registry.observe({
    type: 'error',
    requestId: 'request-a',
    code: 'SESSION_RUNTIME_BINDING_MISMATCH',
    message: 'stale generation',
  });

  assert.deepEqual(failure, {
    requestId: 'request-a',
    sessionId: 'session-a',
    message: 'stale generation',
  });
  assert.equal(adapter.subscribed.has('session-a'), false);
  registry.dispose();
});

test('bootstrap replays stream events received after its snapshot boundary', () => {
  const store = createSessionStore('session-a');
  store.getState().beginBootstrap();
  store.getState().applyEvent({
    type: 'agent.event',
    runtimeId: 'runtime-a',
    epoch: 1,
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    sequence: 11,
    timestamp: '2026-01-01T00:00:00.000Z',
    payload: {
      type: 'message_start',
      message: { id: 'assistant-a', role: 'assistant', content: [] },
    },
  });
  store.getState().applyEvent({
    type: 'agent.event',
    runtimeId: 'runtime-a',
    epoch: 1,
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    sequence: 12,
    timestamp: '2026-01-01T00:00:00.100Z',
    payload: {
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hello' },
    },
  });

  store.getState().hydrate(createSnapshot({ sequence: 10, state: 'running' }));

  const state = store.getState();
  assert.equal(state.loadState, 'ready');
  assert.equal(state.lastSequence, 12);
  assert.equal(state.currentAssistantId, 'assistant-a');
  assert.deepEqual(state.messagesById['assistant-a'].content, [{ type: 'text', text: 'Hello' }]);
  assert.deepEqual(state.bufferedEvents, []);
});

test('optimistic prompt remains visible without returning the projection to bootstrap loading', () => {
  const store = createSessionStore('session-a');
  store.getState().hydrate(createSnapshot());

  store.getState().appendOptimisticUserMessage('request-a', 'Question');

  const pending = store.getState();
  assert.equal(pending.loadState, 'ready');
  assert.equal(pending.runtimeState, 'starting');
  assert.deepEqual(pending.pendingUserRequestIds, ['request-a']);
  assert.equal(pending.messagesById['local-request-a'].content[0].text, 'Question');

  store.getState().applyEvent({
    type: 'agent.event',
    runtimeId: 'runtime-a',
    epoch: 1,
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    sequence: 1,
    timestamp: '2026-01-01T00:00:01.000Z',
    requestId: 'request-a',
    payload: {
      type: 'message_start',
      message: { id: 'user-a', role: 'user', content: [{ type: 'text', text: 'Question' }] },
    },
  });

  const accepted = store.getState();
  assert.deepEqual(accepted.pendingUserRequestIds, []);
  assert.deepEqual(accepted.messageIds, ['user-a']);
});

test('correlated Extension notifications render slash-command responses and settle optimistic state', () => {
  const store = createSessionStore('session-a');
  store.getState().hydrate(createSnapshot());
  store.getState().appendOptimisticUserMessage('ctx-doctor-request', '/ctx-doctor');

  store.getState().applyEvent({
    type: 'extension.ui',
    runtimeId: 'runtime-a',
    epoch: 1,
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    sequence: 1,
    timestamp: '2026-01-01T00:00:01.000Z',
    requestId: 'ctx-doctor-request',
    payload: {
      type: 'extension_ui_request',
      id: 'notification-a',
      method: 'notify',
      message: '## ctx-doctor (Pi)',
      notifyType: 'info',
    },
  });

  const state = store.getState();
  assert.equal(state.runtimeState, 'idle');
  assert.deepEqual(state.pendingUserRequestIds, []);
  assert.deepEqual(state.messageIds, ['local-ctx-doctor-request']);
  assert.deepEqual(state.transcriptItems, [
    {
      type: 'message',
      id: 'local-ctx-doctor-request',
      turnId: 'turn-request-ctx-doctor-request',
    },
    {
      type: 'notification',
      id: 'extension-notify-notification-a',
      turnId: 'turn-request-ctx-doctor-request',
    },
  ]);
  assert.equal(state.turnsById['turn-request-ctx-doctor-request'].status, 'completed');
  assert.equal(getLastItemIndexByTurn(state.transcriptItems).get('turn-request-ctx-doctor-request'), 1);
  assert.deepEqual(state.notificationsById['extension-notify-notification-a'], {
    id: 'extension-notify-notification-a',
    message: '## ctx-doctor (Pi)',
    notifyType: 'info',
    requestId: 'ctx-doctor-request',
    timestamp: Date.parse('2026-01-01T00:00:01.000Z'),
  });
});

test('standalone control notifications render after the preceding completed Turn marker', () => {
  const store = createSessionStore('session-a');
  store.getState().hydrate({
    ...createSnapshot({ sequence: 2, state: 'idle' }),
    messages: [
      {
        id: 'user-a',
        role: 'user',
        content: [{ type: 'text', text: 'Previous question' }],
        timestamp: Date.parse('2026-01-01T00:00:00.000Z'),
        persistedAt: '2026-01-01T00:00:00.100Z',
      },
      {
        id: 'assistant-a',
        role: 'assistant',
        content: [{ type: 'text', text: 'Previous answer' }],
        timestamp: Date.parse('2026-01-01T00:00:01.000Z'),
        persistedAt: '2026-01-01T00:00:05.000Z',
      },
    ],
  });

  store.getState().applyEvent({
    type: 'extension.ui',
    runtimeId: 'runtime-a',
    epoch: 1,
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    sequence: 3,
    timestamp: '2026-01-01T00:00:10.000Z',
    payload: {
      type: 'extension_ui_request',
      id: 'plan-enabled',
      method: 'notify',
      message: 'Plan mode enabled. I will explore and plan, but not modify files.',
      notifyType: 'info',
    },
  });

  const state = store.getState();
  const turnId = 'turn-message-user-a';
  assert.deepEqual(state.transcriptItems, [
    { type: 'message', id: 'user-a', turnId },
    { type: 'message', id: 'assistant-a', turnId },
    { type: 'notification', id: 'extension-notify-plan-enabled' },
  ]);
  assert.equal(getLastItemIndexByTurn(state.transcriptItems).get(turnId), 1);
  assert.equal(state.turnsById[turnId].endedAt, Date.parse('2026-01-01T00:00:05.000Z'));
});

test('notifications emitted inside an active Turn remain before its duration marker', () => {
  const store = createSessionStore('session-a');
  store.getState().hydrate(createSnapshot());
  store.getState().appendOptimisticUserMessage('prompt-a', 'Run an extension');

  store.getState().applyEvent({
    type: 'extension.ui',
    runtimeId: 'runtime-a',
    epoch: 1,
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    sequence: 1,
    timestamp: '2030-01-01T00:00:01.000Z',
    payload: {
      type: 'extension_ui_request',
      id: 'turn-notification',
      method: 'notify',
      message: 'Runtime update',
      notifyType: 'info',
    },
  });

  const state = store.getState();
  const turnId = 'turn-request-prompt-a';
  assert.equal(state.transcriptItems[1].turnId, turnId);
  assert.equal(getLastItemIndexByTurn(state.transcriptItems).get(turnId), 1);
  assert.equal(state.turnsById[turnId].status, 'running');
});

test('correlated Extension notifications release retained slash-command subscriptions', () => {
  const adapter = createSubscriptionAdapter();
  const registry = new SessionRuntimeRegistry(adapter);
  registry.retainCommand('session-a', 'ctx-doctor-request', 0);

  registry.observe({
    type: 'extension.ui',
    runtimeId: 'runtime-a',
    epoch: 1,
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    sequence: 1,
    timestamp: '2026-01-01T00:00:01.000Z',
    requestId: 'ctx-doctor-request',
    payload: { method: 'notify' },
  });

  assert.deepEqual(adapter.transitions, ['subscribe:session-a', 'unsubscribe:session-a']);
  registry.dispose();
});

test('an older warm bootstrap snapshot cannot overwrite newer streamed output', () => {
  const store = createSessionStore('session-a');
  store.getState().hydrate(createSnapshot({ sequence: 10, state: 'running' }));
  store.getState().applyEvent({
    type: 'agent.event',
    runtimeId: 'runtime-a',
    epoch: 1,
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    sequence: 11,
    timestamp: '2026-01-01T00:00:00.000Z',
    payload: {
      type: 'message_start',
      message: { id: 'assistant-a', role: 'assistant', content: [] },
    },
  });
  store.getState().applyEvent({
    type: 'agent.event',
    runtimeId: 'runtime-a',
    epoch: 1,
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    sequence: 12,
    timestamp: '2026-01-01T00:00:00.100Z',
    payload: {
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'newer' },
    },
  });

  store.getState().hydrate(createSnapshot({ sequence: 10, state: 'running' }));

  const state = store.getState();
  assert.equal(state.lastSequence, 12);
  assert.equal(state.currentAssistantId, 'assistant-a');
  assert.deepEqual(state.messagesById['assistant-a'].content, [{ type: 'text', text: 'newer' }]);
});

test('assistant reasoning streams to the first text delta then settles on durable message time', () => {
  const store = createSessionStore('session-a');
  store.getState().hydrate(createSnapshot());
  /**
   * Applies one deterministic agent event to the test store.
   */
  const applyAgentEvent = (sequence, timestamp, payload) => {
    store.getState().applyEvent({
      type: 'agent.event',
      runtimeId: 'runtime-a',
      epoch: 1,
      workspaceId: 'workspace-a',
      sessionId: 'session-a',
      sequence,
      timestamp,
      payload,
    });
  };

  applyAgentEvent(1, '2026-01-01T00:00:00.000Z', {
    type: 'message_start',
    message: { id: 'assistant-a', role: 'assistant', content: [] },
  });
  applyAgentEvent(2, '2026-01-01T00:00:00.500Z', {
    type: 'message_update',
    assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'Reasoning' },
  });
  applyAgentEvent(3, '2026-01-01T00:00:02.000Z', {
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', contentIndex: 1, delta: 'Answer' },
  });
  applyAgentEvent(4, '2026-01-01T00:00:03.000Z', {
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', contentIndex: 1, delta: ' continues' },
  });

  const streaming = store.getState().messagesById['assistant-a'];
  assert.equal(streaming.thinkingStartedAt, Date.parse('2026-01-01T00:00:00.000Z'));
  assert.equal(streaming.thinkingEndedAt, Date.parse('2026-01-01T00:00:02.000Z'));
  assert.equal(store.getState().currentAssistantId, 'assistant-a');

  applyAgentEvent(5, '2026-01-01T00:00:04.000Z', {
    type: 'message_end',
    message: {
      id: 'assistant-a',
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Reasoning' },
        { type: 'text', text: 'Answer continues' },
      ],
    },
  });

  const completed = store.getState().messagesById['assistant-a'];
  assert.equal(completed.thinkingStartedAt, Date.parse('2026-01-01T00:00:00.000Z'));
  assert.equal(completed.thinkingEndedAt, Date.parse('2026-01-01T00:00:04.000Z'));
  assert.equal(store.getState().currentAssistantId, undefined);
});

test('manual compaction is projected as a visible lifecycle row through failure', () => {
  const store = createSessionStore('session-a');
  store.getState().hydrate({
    ...createSnapshot({ sequence: 1, state: 'idle' }),
    contextUsage: { tokens: 12_000, contextWindow: 128_000, percent: 9.375 },
  });

  store.getState().applyEvent({
    type: 'agent.event',
    runtimeId: 'runtime-a',
    epoch: 1,
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    sequence: 2,
    timestamp: '2026-01-01T00:00:01.000Z',
    payload: { type: 'compaction_start', reason: 'manual' },
  });

  const started = store.getState();
  assert.deepEqual(started.transcriptItems, [{ type: 'compaction', id: 'compaction-2' }]);
  assert.equal(started.activeCompactionId, 'compaction-2');
  assert.deepEqual(started.compactionsById['compaction-2'], {
    id: 'compaction-2',
    status: 'running',
    reason: 'manual',
    startedAt: Date.parse('2026-01-01T00:00:01.000Z'),
  });
  assert.equal(started.contextUsage.tokens, null);
  assert.equal(started.contextUsage.percent, null);

  store.getState().applyEvent({
    type: 'agent.event',
    runtimeId: 'runtime-a',
    epoch: 1,
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    sequence: 3,
    timestamp: '2026-01-01T00:00:02.000Z',
    payload: {
      type: 'compaction_end',
      reason: 'manual',
      result: undefined,
      aborted: false,
      willRetry: false,
      errorMessage: 'Compaction failed: Nothing to compact (session too small)',
    },
  });

  const ended = store.getState();
  assert.equal(ended.activeCompactionId, undefined);
  assert.deepEqual(ended.transcriptItems, [{ type: 'compaction', id: 'compaction-2' }]);
  assert.deepEqual(ended.compactionsById['compaction-2'], {
    id: 'compaction-2',
    status: 'error',
    reason: 'manual',
    startedAt: Date.parse('2026-01-01T00:00:01.000Z'),
    endedAt: Date.parse('2026-01-01T00:00:02.000Z'),
    errorMessage: 'Compaction failed: Nothing to compact (session too small)',
  });
});

test('model failures remain visible when an assistant message has no response content', () => {
  const store = createSessionStore('session-a');
  store.getState().hydrate(createSnapshot());
  store.getState().applyEvent({
    type: 'agent.event',
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    runtimeId: 'runtime-a',
    epoch: 1,
    sequence: 1,
    timestamp: '2026-01-01T00:00:01.000Z',
    payload: {
      type: 'message_end',
      message: {
        id: 'assistant-error',
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: 'Insufficient account balance.',
      },
    },
  });

  assert.deepEqual(store.getState().messagesById['assistant-error'], {
    id: 'assistant-error',
    role: 'assistant',
    content: [],
    persistedAt: Date.parse('2026-01-01T00:00:01.000Z'),
    stopReason: 'error',
    errorMessage: 'Insufficient account balance.',
    thinkingStartedAt: undefined,
    thinkingEndedAt: undefined,
  });
  assert.deepEqual(store.getState().transcriptItems, [{ type: 'message', id: 'assistant-error' }]);
});

test('hydration restores durable model failure details', () => {
  const store = createSessionStore('session-a');
  store.getState().hydrate({
    ...createSnapshot(),
    messages: [
      {
        id: 'assistant-error',
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: '  Model is unavailable.  ',
        timestamp: Date.parse('2026-01-01T00:00:01.000Z'),
      },
    ],
  });

  assert.equal(store.getState().messagesById['assistant-error'].errorMessage, 'Model is unavailable.');
  assert.deepEqual(store.getState().transcriptItems, [{ type: 'message', id: 'assistant-error' }]);
});

test('live auto retry owns transient errors and settles as one successful Turn episode', () => {
  const store = createSessionStore('session-a');
  store.getState().hydrate(createSnapshot());
  store.getState().appendOptimisticUserMessage('request-a', 'hello');
  const applyAgentEvent = (sequence, payload) => {
    store.getState().applyEvent({
      type: 'agent.event',
      workspaceId: 'workspace-a',
      sessionId: 'session-a',
      runtimeId: 'runtime-a',
      epoch: 1,
      sequence,
      timestamp: `2026-01-01T00:00:0${String(sequence)}.000Z`,
      payload,
    });
  };

  applyAgentEvent(1, {
    type: 'message_end',
    message: {
      id: 'assistant-error',
      role: 'assistant',
      content: [],
      stopReason: 'error',
      errorMessage: 'Provider unavailable.',
    },
  });
  applyAgentEvent(2, {
    type: 'auto_retry_start',
    attempt: 1,
    maxAttempts: 3,
    delayMs: 2_000,
    errorMessage: 'Provider unavailable.',
  });

  const waiting = store.getState();
  const turnId = waiting.activeTurnId;
  const retry = waiting.turnsById[turnId].retries[0];
  assert.equal(waiting.activeRetryId, retry.id);
  assert.equal(waiting.messagesById['assistant-error'].retryId, retry.id);
  assert.deepEqual(retry, {
    id: retry.id,
    status: 'waiting',
    attempt: 1,
    maxAttempts: 3,
    delayMs: 2_000,
    errorMessage: 'Provider unavailable.',
    scheduledAt: Date.parse('2026-01-01T00:00:02.000Z'),
  });

  applyAgentEvent(3, {
    type: 'message_start',
    message: { id: 'assistant-success', role: 'assistant', content: [] },
  });
  assert.equal(store.getState().turnsById[turnId].retries[0].status, 'retrying');
  applyAgentEvent(4, {
    type: 'message_end',
    message: {
      id: 'assistant-success',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello.' }],
      stopReason: 'stop',
    },
  });
  applyAgentEvent(5, { type: 'auto_retry_end', success: true, attempt: 1 });
  applyAgentEvent(6, { type: 'agent_settled' });

  const settled = store.getState();
  assert.equal(settled.activeRetryId, undefined);
  assert.equal(settled.activeTurnId, undefined);
  assert.equal(settled.turnsById[turnId].retries[0].status, 'succeeded');
  assert.equal(settled.turnsById[turnId].status, 'completed');
});

test('active retry snapshot restores an abortable waiting episode after navigation', () => {
  const store = createSessionStore('session-a');
  store.getState().hydrate({
    ...createSnapshot({ sequence: 4, state: 'running' }),
    activeRetry: {
      phase: 'waiting',
      attempt: 2,
      maxAttempts: 3,
      delayMs: 4_000,
      errorMessage: 'Provider unavailable.',
      scheduledAt: '2026-01-01T00:00:04.000Z',
    },
    messages: [
      {
        id: 'user-a',
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
        timestamp: Date.parse('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'assistant-error',
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: 'Provider unavailable.',
        timestamp: Date.parse('2026-01-01T00:00:03.000Z'),
      },
    ],
  });

  const state = store.getState();
  const retry = state.turnsById[state.activeTurnId].retries[0];
  assert.equal(state.activeRetryId, retry.id);
  assert.equal(state.messagesById['assistant-error'].retryId, retry.id);
  assert.equal(retry.status, 'waiting');
  assert.equal(retry.attempt, 2);
});

test('hydration collapses durable retry failures instead of restoring duplicate error rows', () => {
  const store = createSessionStore('session-a');
  store.getState().hydrate({
    ...createSnapshot(),
    messages: [
      {
        id: 'user-a',
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
        timestamp: Date.parse('2026-01-01T00:00:00.000Z'),
      },
      ...[1, 2, 3, 4].map((attempt) => ({
        id: `assistant-error-${String(attempt)}`,
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: `Provider failure ${String(attempt)}.`,
        timestamp: Date.parse(`2026-01-01T00:00:0${String(attempt)}.000Z`),
      })),
    ],
  });

  const state = store.getState();
  const turn = state.turnsById['turn-message-user-a'];
  assert.equal(turn.retries.length, 1);
  assert.deepEqual(turn.retries[0], {
    id: 'retry-history-turn-message-user-a-assistant-error-1',
    status: 'failed',
    attempt: 3,
    errorMessage: 'Provider failure 4.',
    finalError: 'Provider failure 4.',
    scheduledAt: Date.parse('2026-01-01T00:00:01.000Z'),
    endedAt: Date.parse('2026-01-01T00:00:04.000Z'),
  });
  assert.equal(state.messagesById['assistant-error-1'].retryId, turn.retries[0].id);
  assert.equal(state.messagesById['assistant-error-4'].retryId, turn.retries[0].id);
});

test('aborted assistant output is interrupted before agent settled without a model failure', () => {
  const store = createSessionStore('session-a');
  store.getState().hydrate(createSnapshot());
  const applyAgentEvent = (sequence, payload) => {
    store.getState().applyEvent({
      type: 'agent.event',
      workspaceId: 'workspace-a',
      sessionId: 'session-a',
      runtimeId: 'runtime-a',
      epoch: 1,
      sequence,
      timestamp: `2026-01-01T00:00:0${String(sequence)}.000Z`,
      payload,
    });
  };

  applyAgentEvent(1, {
    type: 'message_start',
    message: { id: 'assistant-aborted', role: 'assistant', content: [] },
  });
  applyAgentEvent(2, {
    type: 'message_end',
    message: {
      id: 'assistant-aborted',
      role: 'assistant',
      content: [],
      stopReason: 'aborted',
      errorMessage: 'This operation was aborted',
    },
  });

  assert.equal(store.getState().messagesById['assistant-aborted'].interrupted, true);
  assert.equal(store.getState().messagesById['assistant-aborted'].errorMessage, undefined);
  applyAgentEvent(3, { type: 'agent_settled' });
  assert.equal(store.getState().messagesById['assistant-aborted'].interrupted, true);
});

test('hydration rebuilds interleaved tools and reasoning time from durable messages', () => {
  const store = createSessionStore('session-a');
  store.getState().hydrate({
    ...createSnapshot(),
    messages: [
      {
        id: 'user-a',
        role: 'user',
        content: [{ type: 'text', text: 'Inspect this' }],
        timestamp: Date.parse('2026-01-01T00:00:00.000Z'),
        persistedAt: '2026-01-01T00:00:00.100Z',
      },
      {
        id: 'assistant-a',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'I should read it.' },
          { type: 'toolCall', id: 'tool-a', name: 'read', arguments: { path: 'a.ts' } },
        ],
        timestamp: Date.parse('2026-01-01T00:00:01.000Z'),
        persistedAt: '2026-01-01T00:00:03.000Z',
      },
      {
        role: 'toolResult',
        toolCallId: 'tool-a',
        toolName: 'read',
        content: [{ type: 'text', text: 'contents' }],
        details: { truncation: { truncated: false } },
        isError: false,
        timestamp: Date.parse('2026-01-01T00:00:04.000Z'),
        persistedAt: '2026-01-01T00:00:05.000Z',
      },
      {
        id: 'assistant-b',
        role: 'assistant',
        content: [{ type: 'text', text: 'Done' }],
        timestamp: Date.parse('2026-01-01T00:00:06.000Z'),
        persistedAt: '2026-01-01T00:00:07.000Z',
      },
    ],
  });

  const state = store.getState();
  assert.deepEqual(state.messageIds, ['user-a', 'assistant-a', 'assistant-b']);
  assert.deepEqual(state.transcriptItems, [
    { type: 'message', id: 'user-a', turnId: 'turn-message-user-a' },
    { type: 'message', id: 'assistant-a', turnId: 'turn-message-user-a' },
    { type: 'tool', id: 'tool-a', turnId: 'turn-message-user-a' },
    { type: 'message', id: 'assistant-b', turnId: 'turn-message-user-a' },
  ]);
  assert.equal(state.messagesById['assistant-a'].thinkingStartedAt, Date.parse('2026-01-01T00:00:01.000Z'));
  assert.equal(state.messagesById['assistant-a'].thinkingEndedAt, Date.parse('2026-01-01T00:00:03.000Z'));
  assert.deepEqual(state.toolsById['tool-a'], {
    id: 'tool-a',
    name: 'read',
    status: 'success',
    arguments: { path: 'a.ts' },
    content: [{ type: 'text', text: 'contents' }],
    details: { truncation: { truncated: false } },
    startedAt: Date.parse('2026-01-01T00:00:03.000Z'),
    endedAt: Date.parse('2026-01-01T00:00:05.000Z'),
  });
});

test('realtime tool events retain server order and transport timestamps', () => {
  const store = createSessionStore('session-a');
  store.getState().hydrate(createSnapshot({ state: 'running' }));
  /**
   * Applies one deterministic Agent event to the hydrated projection.
   */
  const applyAgentEvent = (sequence, timestamp, payload) => {
    store.getState().applyEvent({
      type: 'agent.event',
      runtimeId: 'runtime-a',
      epoch: 1,
      workspaceId: 'workspace-a',
      sessionId: 'session-a',
      sequence,
      timestamp,
      payload,
    });
  };

  applyAgentEvent(1, '2026-01-01T00:00:00.000Z', {
    type: 'message_start',
    message: { id: 'assistant-a', role: 'assistant', content: [] },
  });
  applyAgentEvent(2, '2026-01-01T00:00:02.000Z', {
    type: 'tool_execution_start',
    toolCallId: 'tool-a',
    toolName: 'read',
    args: { path: 'a.ts' },
  });
  applyAgentEvent(3, '2026-01-01T00:00:05.000Z', {
    type: 'tool_execution_end',
    toolCallId: 'tool-a',
    toolName: 'read',
    result: 'contents',
  });

  const state = store.getState();
  assert.deepEqual(state.transcriptItems, [
    { type: 'message', id: 'assistant-a' },
    { type: 'tool', id: 'tool-a' },
  ]);
  assert.equal(state.toolsById['tool-a'].startedAt, Date.parse('2026-01-01T00:00:02.000Z'));
  assert.equal(state.toolsById['tool-a'].endedAt, Date.parse('2026-01-01T00:00:05.000Z'));
  assert.deepEqual(state.toolsById['tool-a'].content, [{ type: 'text', text: 'contents' }]);
});

test('realtime Pi tool results project content and structured details independently', () => {
  const store = createSessionStore('session-a');
  store.getState().hydrate(createSnapshot({ state: 'running' }));
  store.getState().applyEvent({
    type: 'agent.event',
    runtimeId: 'runtime-a',
    epoch: 1,
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    sequence: 1,
    timestamp: '2026-01-01T00:00:00.000Z',
    payload: {
      type: 'tool_execution_end',
      toolCallId: 'tool-a',
      toolName: 'edit',
      args: { path: 'a.ts' },
      result: {
        content: [{ type: 'text', text: 'Updated a.ts' }],
        details: { diff: '-old\n+new' },
        addedToolNames: ['follow_up'],
      },
      isError: false,
    },
  });

  assert.deepEqual(store.getState().toolsById['tool-a'], {
    id: 'tool-a',
    name: 'edit',
    status: 'success',
    arguments: { path: 'a.ts' },
    content: [{ type: 'text', text: 'Updated a.ts' }],
    details: { diff: '-old\n+new' },
    addedToolNames: ['follow_up'],
    startedAt: Date.parse('2026-01-01T00:00:00.000Z'),
    endedAt: Date.parse('2026-01-01T00:00:00.000Z'),
  });
});
