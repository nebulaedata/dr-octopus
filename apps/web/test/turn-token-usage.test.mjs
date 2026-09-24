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
  emit({ type: 'message_start', message: messages[1] });
  assert.equal(selectTurnTokenUsage(state, 'turn-message-user'), undefined);
  emit({ type: 'message_end', message: messages[1] });
  assert.deepEqual(selectTurnTokenUsage(state, 'turn-message-user'), { input: 450, output: 20 });
  emit({ type: 'message_end', message: messages[2] });
  emit({ type: 'message_start', message: messages[3] });
  assert.deepEqual(selectTurnTokenUsage(state, 'turn-message-user'), { input: 450, output: 20 });
  emit({ type: 'message_end', message: messages[3] });
  assert.deepEqual(selectTurnTokenUsage(state, 'turn-message-user'), { input: 900, output: 40 });
});
