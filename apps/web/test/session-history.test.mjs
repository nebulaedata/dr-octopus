/**
 * @author Codex
 * @description Verifies history previews never authorize runtime operations or overwrite newer live messages.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionStore } from '../src/stores/session/store.ts';

const history = {
  sessionId: 'session',
  messages: [{ role: 'user', content: 'persisted', entryId: 'entry' }],
  messageFeedback: [],
};

test('preview is visible before ready, preserving drafts, buffers, sequence and runtime identity', () => {
  const store = createSessionStore('session');
  store.getState().setDraft('unsent text');
  store.getState().beginBootstrap();
  const bufferedEvents = [{ sequence: 1 }];
  store.setState({ bufferedEvents });
  store.getState().previewHistory(history);
  const state = store.getState();
  assert.equal(state.historyLoaded, true);
  assert.equal(state.hydrated, false);
  assert.equal(state.loadState, 'loading');
  assert.equal(state.runtimeId, undefined);
  assert.equal(state.epoch, undefined);
  assert.equal(state.lastSequence, 0);
  assert.equal(state.draft, 'unsent text');
  assert.equal(state.bufferedEvents, bufferedEvents);
  assert.equal(state.messageIds.length, 1);
  store.getState().failBootstrap('startup failed');
  assert.equal(store.getState().historyLoaded, true);
  assert.equal(store.getState().messageIds.length, 1);
});

test('empty history ends transcript loading without marking an empty runtime ready', () => {
  const store = createSessionStore('session');
  store.getState().beginBootstrap();
  store.getState().previewHistory({ ...history, messages: [] });
  assert.equal(store.getState().historyLoaded, true);
  assert.equal(store.getState().hydrated, false);
});

test('foreign, late live and optimistic previews cannot overwrite the current transcript', () => {
  const store = createSessionStore('session');
  store.getState().previewHistory({ ...history, sessionId: 'foreign' });
  assert.equal(store.getState().historyLoaded, false);
  store.setState({ hydrated: true, loadState: 'ready', messageIds: ['live'], lastSequence: 9 });
  const live = store.getState();
  store.getState().previewHistory(history);
  assert.equal(store.getState(), live);
  store.setState({ hydrated: false, pendingUserRequestIds: ['optimistic'] });
  const optimistic = store.getState();
  store.getState().previewHistory(history);
  assert.equal(store.getState(), optimistic);
});

test('live hydration replaces the preview without duplicates and retains the browser draft', () => {
  const store = createSessionStore('session');
  store.getState().beginBootstrap();
  store.getState().setDraft('still editing');
  store.getState().previewHistory(history);
  const state = store.getState();
  store.getState().hydrate({
    session: { id: 'session' },
    messages: [
      ...history.messages,
      { role: 'assistant', content: [{ type: 'text', text: 'new answer' }], entryId: 'answer' },
    ],
    sequence: 4,
    runtime: { runtimeId: 'runtime', epoch: 2, state: 'idle' },
    thinking: state.thinking,
    permission: state.permission,
    planMode: state.planMode,
    pendingExtensionUi: [],
  });
  assert.equal(store.getState().messageIds.length, 2);
  assert.equal(store.getState().hydrated, true);
  assert.equal(store.getState().runtimeId, 'runtime');
  assert.equal(store.getState().lastSequence, 4);
  assert.equal(store.getState().draft, 'still editing');
  store.getState().previewHistory(history);
  assert.equal(store.getState().messageIds.length, 2);
});

test('fresh history replaces a cached preview after bootstrap failure without losing drafts or events', () => {
  const store = createSessionStore('session');
  store.getState().beginBootstrap();
  store.getState().previewHistory(history);
  store.getState().setDraft('continue editing');
  const bufferedEvents = [{ sequence: 1 }];
  store.setState({ bufferedEvents });
  store.getState().failBootstrap('startup failed');
  store.getState().previewHistory({
    ...history,
    messages: [
      ...history.messages,
      { role: 'assistant', content: [{ type: 'text', text: 'latest answer' }], entryId: 'answer' },
    ],
    messageFeedback: [{ entryId: 'answer', rating: 'up' }],
  });
  const state = store.getState();
  assert.deepEqual(state.messageIds.map((id) => state.messagesById[id].entryId), ['entry', 'answer']);
  assert.equal(state.messagesById[state.messageIds[1]].feedback, 'up');
  assert.equal(state.draft, 'continue editing');
  assert.equal(state.bufferedEvents, bufferedEvents);
  assert.equal(state.loadState, 'error');
  assert.equal(state.error, 'startup failed');
  assert.equal(state.hydrated, false);
  assert.equal(state.runtimeId, undefined);
});
