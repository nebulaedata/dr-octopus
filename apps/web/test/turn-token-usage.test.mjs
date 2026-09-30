/**
 * @author Codex
 * @description Verifies turn token accounting across tool loops, history, streaming and missing usage.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionStore } from '../src/stores/session/store.ts';
import { normalizeTokenUsage, selectTurnTokenUsage } from '../src/stores/session/utils/token-usage.ts';
import { reduceEvent } from '../src/stores/session/reducers/session-reducer.ts';

const usage = { input: 100, output: 20, cacheRead: 300, cacheWrite: 50, totalTokens: 470 };
const messages = [
  { id: 'user', role: 'user', content: 'Hello', timestamp: 1000 },
  {
    id: 'call',
    role: 'assistant',
    content: [{ type: 'toolCall', id: 'tool', name: 'read', arguments: {} }],
    usage,
    timestamp: 2000,
  },
  { id: 'tool-result', role: 'toolResult', toolCallId: 'tool', content: [], usage, timestamp: 3000 },
  { id: 'answer', role: 'assistant', content: [{ type: 'text', text: 'Done' }], usage, timestamp: 4000 },
];

test('prompt includes both cache categories and absent or invalid usage remains unknown', () => {
  assert.deepEqual(normalizeTokenUsage(usage), { input: 450, output: 20 });
  for (const value of [undefined, {}, { ...usage, input: NaN }, { ...usage, output: -1 }]) {
    assert.equal(normalizeTokenUsage(value), undefined);
  }
  assert.deepEqual(normalizeTokenUsage({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }), {
    input: 0,
    output: 0,
  });
});

test('history sums the whole tool loop without tool-result double counting or crossing turns', () => {
  const store = createSessionStore('session');
  store.getState().previewHistory({
    sessionId: 'session',
    messageFeedback: [],
    messages: [
      ...messages,
      { id: 'next-user', role: 'user', content: 'Next', timestamp: 5000 },
      { id: 'next-answer', role: 'assistant', content: [], usage, timestamp: 6000 },
    ],
  });
  const state = store.getState();
  assert.deepEqual(selectTurnTokenUsage(state, 'turn-message-user'), { input: 900, output: 40 });
  assert.deepEqual(selectTurnTokenUsage(state, 'turn-message-next-user'), { input: 450, output: 20 });
  assert.equal(selectTurnTokenUsage(state, 'missing'), undefined);
  assert.deepEqual(
    selectTurnTokenUsage(
      { ...state, transcriptItems: [...state.transcriptItems, ...state.transcriptItems] },
      'turn-message-user'
    ),
    { input: 900, output: 40 }
  );
});

test('live final messages replace provisional usage and match history totals', () => {
  let state = createSessionStore('session').getState();
  let sequence = 0;
  /**
   * Applies an ordered Pi lifecycle event through the production reducer.
   */
  function emit(payload) {
    state = reduceEvent(state, {
      type: 'agent.event',
      runtimeId: 'runtime',
      epoch: 1,
      sequence: ++sequence,
      timestamp: sequence * 1000,
      payload,
    });
  }
  emit({ type: 'message_end', message: messages[0] });
  emit({ type: 'message_start', message: { ...messages[1], content: [], usage: undefined } });
  assert.equal(selectTurnTokenUsage(state, 'turn-message-user'), undefined);
  emit({
    type: 'message_update',
    usage: { ...usage, output: 7 },
    assistantMessageEvent: { type: 'toolcall_delta', contentIndex: 0, delta: '{' },
  });
  assert.deepEqual(selectTurnTokenUsage(state, 'turn-message-user'), { input: 450, output: 7 });
  emit({ type: 'message_end', message: messages[1] });
  assert.deepEqual(selectTurnTokenUsage(state, 'turn-message-user'), { input: 450, output: 20 });
  emit({ type: 'message_end', message: messages[2] });
  emit({ type: 'message_start', message: { ...messages[3], content: [], usage: undefined } });
  assert.deepEqual(selectTurnTokenUsage(state, 'turn-message-user'), { input: 450, output: 20 });
  emit({
    type: 'message_update',
    usage: { ...usage, output: 11 },
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Done' },
  });
  assert.deepEqual(selectTurnTokenUsage(state, 'turn-message-user'), { input: 900, output: 31 });
  emit({ type: 'message_end', message: messages[3] });
  assert.deepEqual(selectTurnTokenUsage(state, 'turn-message-user'), { input: 900, output: 40 });
});

/**
 * Replays the real wire envelope with deterministic sequence and receive times.
 */
function createReplay() {
  let state = createSessionStore('session').getState();
  let sequence = 0;
  return {
    get state() {
      return state;
    },
    /**
     * Applies one event or repeats a supplied envelope to exercise transport deduplication.
     */
    emit(payload, repeatedEnvelope) {
      const envelope = repeatedEnvelope ?? {
        type: 'agent.event',
        runtimeId: 'runtime',
        epoch: 1,
        sequence: ++sequence,
        timestamp: new Date(sequence * 1000).toISOString(),
        payload,
      };
      state = reduceEvent(state, envelope);
      return envelope;
    },
  };
}

test('streaming snapshots replace usage, preserve content and ignore missing or invalid usage', () => {
  const replay = createReplay();
  replay.emit({ type: 'message_end', message: messages[0] });
  replay.emit({ type: 'message_start', message: { ...messages[3], content: [], usage: undefined } });
  const first = replay.emit({
    type: 'message_update',
    usage,
    assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'Think' },
  });
  replay.emit(undefined, first);
  assert.deepEqual(selectTurnTokenUsage(replay.state, 'turn-message-user'), { input: 450, output: 20 });
  assert.equal(replay.state.messagesById.answer.content[0].text, 'Think');
  for (const updateUsage of [usage, undefined, { ...usage, output: -1 }, { input: 100 }]) {
    replay.emit({
      type: 'message_update',
      usage: updateUsage,
      assistantMessageEvent: { type: 'text_delta', contentIndex: 1, delta: '.' },
    });
    assert.deepEqual(selectTurnTokenUsage(replay.state, 'turn-message-user'), { input: 450, output: 20 });
  }
  assert.equal(replay.state.messagesById.answer.content[1].text, '....');
  replay.emit({ type: 'message_update', usage: { ...usage, output: 35 } });
  assert.deepEqual(selectTurnTokenUsage(replay.state, 'turn-message-user'), { input: 450, output: 35 });
  // A corrected authoritative total may be lower than the last provisional snapshot.
  replay.emit({ type: 'message_end', message: messages[3] });
  assert.deepEqual(selectTurnTokenUsage(replay.state, 'turn-message-user'), { input: 450, output: 20 });
  replay.emit({ type: 'message_update', usage: { ...usage, output: 999 } });
  assert.deepEqual(selectTurnTokenUsage(replay.state, 'turn-message-user'), { input: 450, output: 20 });
});

test('retry and aborted requests each contribute only their own reported usage', () => {
  const replay = createReplay();
  replay.emit({ type: 'message_end', message: messages[0] });
  replay.emit({ type: 'message_start', message: messages[1] });
  assert.deepEqual(selectTurnTokenUsage(replay.state, 'turn-message-user'), { input: 450, output: 20 });
  replay.emit({ type: 'message_end', message: { ...messages[1], stopReason: 'error', errorMessage: '503' } });
  replay.emit({ type: 'auto_retry_start', attempt: 1, maxAttempts: 2, delayMs: 100, errorMessage: '503' });
  replay.emit({ type: 'message_start', message: { ...messages[3], usage: undefined } });
  replay.emit({
    type: 'message_update',
    usage: { ...usage, output: 5 },
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Partial' },
  });
  assert.deepEqual(selectTurnTokenUsage(replay.state, 'turn-message-user'), { input: 900, output: 25 });
  replay.emit({
    type: 'message_end',
    message: { ...messages[3], stopReason: 'aborted', usage: { ...usage, output: 8 } },
  });
  replay.emit({ type: 'agent_settled' });
  assert.deepEqual(selectTurnTokenUsage(replay.state, 'turn-message-user'), { input: 900, output: 28 });
});
