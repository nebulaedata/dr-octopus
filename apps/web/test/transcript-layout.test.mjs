/**
 * @author Codex
 * @description Covers tool grouping boundaries, hidden history messages, stable append identity and Turn markers.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionStore } from '../src/stores/session/store.ts';
import {
  groupTranscriptRows,
  isTranscriptMessageVisible,
  selectVisibleTranscriptMessageIds,
} from '../src/features/session/utils/transcript-layout.ts';

/**
 * Constructs an owned tool identity independent of result payload updates.
 */
function tool(id, turnId = 'turn') {
  return { type: 'tool', id, turnId };
}

test('consecutive tools merge across hidden call messages while append preserves first-tool identity', () => {
  const start = [tool('one')];
  const appended = [...start, { type: 'message', id: 'empty', turnId: 'turn' }, tool('two')];
  const first = groupTranscriptRows(start, []);
  const next = groupTranscriptRows(appended, []);
  assert.equal(first[0].id, next[0].id);
  assert.deepEqual(next, [
    { type: 'tools', id: 'one', toolIds: ['one', 'two'], turnId: 'turn' },
    { type: 'turn-end', turnId: 'turn' },
  ]);
  assert.deepEqual(start, [tool('one')]);
});

test('visible messages, notifications, compactions and Turn changes break groups', () => {
  for (const boundary of [
    { type: 'message', id: 'body', turnId: 'turn' },
    { type: 'notification', id: 'note', turnId: 'turn' },
    { type: 'compaction', id: 'compact' },
  ]) {
    const rows = groupTranscriptRows([tool('one'), boundary, tool('two')], ['body']);
    assert.deepEqual(
      rows.filter((row) => row.type === 'tools').map((row) => row.toolIds),
      [['one'], ['two']]
    );
    assert.equal(rows[1].item.id, boundary.id);
  }
  const rows = groupTranscriptRows([tool('one'), tool('two', 'next')], []);
  assert.deepEqual(
    rows.map((row) => row.type),
    ['tools', 'turn-end', 'tools', 'turn-end']
  );
  assert.equal(
    groupTranscriptRows(
      [
        { type: 'tool', id: 'one' },
        { type: 'tool', id: 'two' },
      ],
      []
    ).length,
    2
  );
});

test('hidden final messages retain the original Turn marker after the group', () => {
  const rows = groupTranscriptRows([tool('one'), { type: 'message', id: 'empty-end', turnId: 'turn' }], []);
  assert.deepEqual(
    rows.map((row) => row.type),
    ['tools', 'turn-end']
  );
});

test('visibility keeps streaming, reasoning, attachments and terminal errors, but defers retry failures', () => {
  const empty = { id: 'message', role: 'assistant', content: [] };
  assert.equal(isTranscriptMessageVisible(empty, false), false);
  assert.equal(isTranscriptMessageVisible(empty, true), true);
  for (const block of [
    { type: 'text', text: 'body' },
    { type: 'thinking', text: 'thought' },
    { type: 'image', data: 'a', mimeType: 'image/png' },
  ]) {
    assert.equal(isTranscriptMessageVisible({ ...empty, content: [block] }, false), true);
  }
  const failure = { ...empty, stopReason: 'error', errorMessage: 'failed' };
  assert.equal(isTranscriptMessageVisible(failure, false, 'running'), false);
  assert.equal(isTranscriptMessageVisible(failure, false, 'completed'), true);
  assert.equal(isTranscriptMessageVisible({ ...failure, retryId: 'retry' }, false, 'completed'), false);
  assert.equal(isTranscriptMessageVisible({ ...failure, interrupted: true }, false, 'running'), true);
});

test('persisted tool-only assistant envelopes produce the same compact group as live tool identities', () => {
  const store = createSessionStore('grouping-test');
  store.getState().previewHistory({
    sessionId: 'grouping-test',
    messageFeedback: [],
    messages: [
      { id: 'user', role: 'user', content: 'Start', timestamp: 1000 },
      {
        id: 'call-one',
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'one', name: 'read', arguments: {} }],
        timestamp: 2000,
      },
      { role: 'toolResult', toolCallId: 'one', content: [], timestamp: 3000 },
      {
        id: 'call-two',
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'two', name: 'mcp', arguments: {} }],
        timestamp: 4000,
      },
      { role: 'toolResult', toolCallId: 'two', content: [], timestamp: 5000 },
      { id: 'answer', role: 'assistant', content: 'Done', timestamp: 6000 },
    ],
  });
  const state = store.getState();
  const visible = selectVisibleTranscriptMessageIds(state);
  assert.deepEqual(visible, ['user', 'answer']);
  const groups = groupTranscriptRows(state.transcriptItems, visible).filter((row) => row.type === 'tools');
  assert.deepEqual(groups, [
    { type: 'tools', id: 'one', toolIds: ['one', 'two'], turnId: 'turn-message-user' },
  ]);
  const next = {
    ...state,
    toolsById: {
      ...state.toolsById,
      one: { ...state.toolsById.one, content: [{ type: 'text', text: 'streaming chunk' }] },
    },
  };
  assert.deepEqual(selectVisibleTranscriptMessageIds(next), visible);
});
