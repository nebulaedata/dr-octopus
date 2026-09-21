/**
 * @author Codex
 * @description Verifies committed memory receipt identity, live/history parity and safe message fallback.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { projectMemorySave } from '../src/features/session/memory-save-projection.ts';
import { normalizeMessage, projectPersistedTranscript } from '../src/stores/session/normalizer.ts';
import { createSessionStore } from '../src/stores/session/store.ts';

const receipt = {
  id: 'memory-receipt',
  role: 'custom',
  customType: 'octopus-memory-operation',
  content: '已保存 2 条长期记忆。',
  display: true,
  timestamp: 1_800_000_000_000,
};

/**
 * Creates the real browser store with an isolated runtime generation.
 */
function createStore() {
  const store = createSessionStore('session-memory');
  store.setState({ runtimeId: 'runtime-memory', epoch: 1 });
  return store;
}

/**
 * Delivers an ordered Pi lifecycle event through the production reducer.
 */
function applyMessage(store, sequence, type, message) {
  store.getState().applyEvent({
    type: 'agent.event',
    runtimeId: 'runtime-memory',
    workspaceId: 'workspace-memory',
    sessionId: 'session-memory',
    epoch: 1,
    sequence,
    timestamp: new Date(receipt.timestamp).toISOString(),
    payload: { type, message },
  });
}

test('live and persisted memory receipts retain identity and render the same count once', () => {
  const store = createStore();
  applyMessage(store, 1, 'message_start', receipt);
  applyMessage(store, 2, 'message_end', receipt);
  applyMessage(store, 2, 'message_end', receipt);
  const live = store.getState();
  const history = projectPersistedTranscript([receipt]);
  assert.deepEqual(live.messageIds, [receipt.id]);
  assert.deepEqual(live.transcriptItems, history.transcriptItems);
  assert.equal(live.messagesById[receipt.id].customType, receipt.customType);
  assert.deepEqual(projectMemorySave(live.messagesById[receipt.id]), { count: 2 });
  assert.deepEqual(projectMemorySave(history.messages[0]), { count: 2 });
  assert.equal(history.messages[0].timestamp, receipt.timestamp);
});

test('hidden memory receipts stay absent from both live and persisted transcripts', () => {
  const hidden = { ...receipt, display: false };
  const store = createStore();
  applyMessage(store, 1, 'message_start', hidden);
  applyMessage(store, 2, 'message_end', hidden);
  assert.deepEqual(store.getState().messageIds, []);
  assert.deepEqual(projectPersistedTranscript([hidden]).messages, []);
});

test('assistant claims, unknown formats and failed messages cannot become success cards', () => {
  for (const override of [
    { role: 'assistant' },
    { role: 'user' },
    { role: 'unrecognized-role' },
    { customType: undefined },
    { customType: 'another-extension' },
    { content: '记忆保存失败' },
    { content: '已保存 0 条长期记忆。' },
    { content: '已保存 -1 条长期记忆。' },
    { content: '已保存 1.5 条长期记忆。' },
    { content: '已保存 9007199254740992 条长期记忆。' },
    { content: '已保存 2 条长期记忆。\n额外消息' },
    {
      content: [
        { type: 'text', text: receipt.content },
        { type: 'image', data: '', mimeType: 'image/png' },
      ],
    },
    { errorMessage: 'failed' },
    { stopReason: 'error' },
  ]) {
    const message = normalizeMessage({ ...receipt, ...override }, 'fallback');
    assert.equal(projectMemorySave(message), undefined, JSON.stringify(override));
    assert.ok(message.content.length > 0, 'fallback retains the original message');
  }
  assert.equal(projectMemorySave({ ...normalizeMessage(receipt, 'fallback'), interrupted: true }), undefined);
  assert.equal(normalizeMessage({ ...receipt, role: 'assistant' }, 'fallback').customType, undefined);
});

test('array-based persisted receipts work without a timestamp', () => {
  const message = normalizeMessage(
    {
      ...receipt,
      timestamp: undefined,
      content: [{ type: 'text', text: '已保存 1 条长期记忆。' }],
    },
    'fallback'
  );
  assert.deepEqual(projectMemorySave(message), { count: 1 });
  assert.equal(message.timestamp, undefined);
});

test('a late memory receipt cannot overwrite or finish a streaming assistant response', () => {
  const store = createStore();
  const assistant = { id: 'assistant-next', role: 'assistant', content: '下一轮回答' };
  applyMessage(store, 1, 'message_start', assistant);
  applyMessage(store, 2, 'message_start', receipt);
  applyMessage(store, 3, 'message_end', receipt);
  assert.equal(store.getState().currentAssistantId, assistant.id);
  assert.equal(store.getState().messagesById[assistant.id].content[0].text, assistant.content);
  assert.deepEqual(projectMemorySave(store.getState().messagesById[receipt.id]), { count: 2 });
  applyMessage(store, 4, 'message_end', { ...assistant, content: '下一轮回答完成' });
  assert.equal(store.getState().currentAssistantId, undefined);
  assert.equal(store.getState().messagesById[assistant.id].content[0].text, '下一轮回答完成');
  assert.deepEqual(store.getState().messageIds, [assistant.id, receipt.id]);
});
