/**
 * @author Codex
 * @description Exercises subscription release and delayed hydration races through the realtime message handler.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRealtimeMessageHandler } from '../src/queries/realtime-message-handler.ts';
import { SessionRuntimeRegistry } from '../src/lib/runtime/session-runtime-registry.ts';
import { createSessionStore } from '../src/stores/session/store.ts';

/**
 * Wires the production handler and retention registry to a controllable snapshot request and binding.
 */
function createFixture() {
  const snapshot = {
    session: { id: 'session', workspaceId: 'workspace' },
    runtime: {
      runtimeId: 'runtime',
      epoch: 1,
      sessionId: 'session',
      workspaceId: 'workspace',
      state: 'idle',
      lastActiveAt: 0,
    },
    sequence: 1,
    messages: [],
    pendingExtensionUi: [],
    thinking: { level: 'off', availableLevels: ['off'] },
  };
  const store = createSessionStore('session');
  const response = Promise.withResolvers();
  let binding = snapshot.runtime;
  const registry = new SessionRuntimeRegistry({
    subscribeSession() {},
    unsubscribeSession() {
      binding = undefined;
    },
  });
  const invalidated = [];
  const handle = createRealtimeMessageHandler({
    queryClient: {
      invalidateQueries: async (filter) => {
        invalidated.push(filter.queryKey);
      },
      fetchQuery: () => response.promise,
    },
    realtimeClient: { getConfirmedSubscription: () => binding },
    browserSessionRuntime: registry,
    sessionStores: { ensure: () => store },
  });
  return {
    snapshot,
    invalidated,
    store,
    registry,
    handle,
    response,
    getBinding: () => binding,
    subscribe: () => handle({ type: 'session.subscribed', sessionId: 'session', runtime: snapshot.runtime }),
    event: (state, runtimeId = 'runtime') => ({
      type: 'agent.state',
      sessionId: 'session',
      workspaceId: 'workspace',
      runtimeId,
      epoch: 1,
      sequence: 2,
      payload: { state },
    }),
  };
}

test('background completion updates the projection even when observing it releases the subscription', () => {
  const fixture = createFixture();
  try {
    fixture.store.getState().hydrate({
      ...fixture.snapshot,
      runtime: { ...fixture.snapshot.runtime, state: 'running' },
    });
    fixture.registry.adoptRuntimeState('session', 'running');
    fixture.handle(fixture.event('idle'));
    assert.equal(fixture.getBinding(), undefined);
    assert.equal(fixture.store.getState().runtimeState, 'idle');
    assert.equal(fixture.store.getState().lastSequence, 2);
  } finally {
    fixture.registry.dispose();
  }
});

test('an old generation cannot settle retention or mutate the active projection', () => {
  const fixture = createFixture();
  try {
    fixture.store.getState().hydrate({
      ...fixture.snapshot,
      runtime: { ...fixture.snapshot.runtime, state: 'running' },
    });
    fixture.registry.adoptRuntimeState('session', 'running');
    fixture.handle(fixture.event('idle', 'old-runtime'));
    assert.equal(fixture.getBinding().runtimeId, 'runtime');
    assert.equal(fixture.store.getState().runtimeState, 'running');
    assert.equal(fixture.store.getState().lastSequence, 1);
  } finally {
    fixture.registry.dispose();
  }
});

test('a delayed subscription snapshot preserves a prompt accepted after bootstrap at the same sequence', async () => {
  const fixture = createFixture();
  try {
    fixture.store.getState().beginBootstrap();
    fixture.subscribe();
    fixture.store.getState().hydrate(fixture.snapshot);
    fixture.store.getState().appendOptimisticUserMessage('prompt', 'Hello');
    const messageIds = fixture.store.getState().messageIds;
    fixture.response.resolve(fixture.snapshot);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(fixture.store.getState().pendingUserRequestIds, ['prompt']);
    assert.deepEqual(fixture.store.getState().messageIds, messageIds);
    assert.equal(fixture.store.getState().runtimeState, 'starting');
  } finally {
    fixture.registry.dispose();
  }
});

test('a subscription snapshot still hydrates an uninitialized generation and replays buffered events', async () => {
  const fixture = createFixture();
  try {
    fixture.store.getState().beginBootstrap();
    fixture.store.getState().setDraft('Keep this draft');
    fixture.subscribe();
    fixture.handle(fixture.event('running'));
    fixture.response.resolve(fixture.snapshot);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(fixture.store.getState().loadState, 'ready');
    assert.equal(fixture.store.getState().runtimeId, 'runtime');
    assert.equal(fixture.store.getState().runtimeState, 'running');
    assert.equal(fixture.store.getState().lastSequence, 2);
    assert.equal(fixture.store.getState().draft, 'Keep this draft');
  } finally {
    fixture.registry.dispose();
  }
});

test('rejected runtime controls reconcile optimistic session metadata without waiting for another event', () => {
  const fixture = createFixture();
  const close = fixture.registry.openView('session');
  try {
    fixture.registry.retainCommand('session', 'model-change', 1, true);
    fixture.handle({
      type: 'error',
      requestId: 'model-change',
      sessionId: 'session',
      code: 'SESSION_RUNTIME_STALE',
      message: 'Model change rejected',
    });
    assert.deepEqual(fixture.invalidated, [['sessions']]);
  } finally {
    close();
    fixture.registry.dispose();
  }
});
