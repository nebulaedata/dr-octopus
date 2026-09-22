/**
 * @author Codex
 * @description Verifies unstarted draft submissions reject malformed ownership and model-selection contracts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { ConversationStartSchema, DraftControlsSchema } from '../dist/protocol/index.js';

test('first-message admission validates identity, content, version and explicit model intent', () => {
  const valid = {
    submissionId: randomUUID(),
    draftId: randomUUID(),
    draftVersion: 0,
    message: 'Hello',
    selection: { mode: 'follow-default' },
  };
  assert.equal(ConversationStartSchema.safeParse(valid).success, true);
  for (const override of [
    { submissionId: 'bad' },
    { message: ' ' },
    { draftVersion: -1 },
    { selection: { mode: 'explicit', provider: 'p' } },
    { attachmentIds: Array(101).fill('id') },
  ]) {
    assert.equal(ConversationStartSchema.safeParse({ ...valid, ...override }).success, false);
  }
});

test('draft knowledge scope shares the runtime validation contract and retains inactive selection', () => {
  const controls = {
    workMode: 'knowledge',
    knowledge: { collectionIds: ['workspace-source', 'global-source'] },
  };
  assert.deepEqual(DraftControlsSchema.parse(controls), controls);
  assert.deepEqual(DraftControlsSchema.parse({ workMode: 'knowledge' }), { workMode: 'knowledge' });
  assert.deepEqual(
    DraftControlsSchema.parse({ ...controls, workMode: 'agent' }).knowledge,
    controls.knowledge
  );
  for (const knowledge of [
    null,
    {},
    { collectionIds: ['same', 'same'] },
    { collectionIds: [' '] },
    { collectionIds: [123] },
    { collectionIds: Array.from({ length: 21 }, (_, i) => String(i)) },
    { collectionIds: ['x'.repeat(201)] },
  ]) {
    assert.equal(DraftControlsSchema.safeParse({ ...controls, knowledge }).success, false);
  }
});
