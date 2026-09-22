/**
 * @author Codex
 * @description Verifies refresh-safe input, model intent and submission identity independently of runtime state.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHomeDraftStore } from '../src/stores/home-drafts.ts';

test('text, serialized mentions, explicit choice and pending request survive reload', () => {
  const data = new Map();
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
  const first = createHomeDraftStore(() => storage);
  const editor = {
    text: 'Read @README.md',
    references: [{ path: 'README.md', kind: 'file', label: 'README.md' }],
    editorState: '{"root":{"type":"root","children":[]}}',
  };
  first.getState().edit('draft', editor);
  first.getState().select('draft', { mode: 'explicit', provider: 'p', modelId: 'm' });
  first.getState().controls('draft', { permissionMode: 'ask', workMode: 'plan', thinkingLevel: 'high' });
  first.getState().submission('draft', { submissionId: 'saved-request', draftId: 'draft', draftVersion: 3 });
  const next = createHomeDraftStore(() => storage);
  assert.deepEqual(next.getState().drafts.draft, first.getState().drafts.draft);
  next.getState().edit('draft', editor);
  assert.equal(next.getState().drafts.draft.version, 3, 'hydration must not invent an edit');
  next.getState().edit('draft', { ...editor, text: 'New text' });
  next.getState().accepted('draft', 3);
  assert.equal(next.getState().drafts.draft.editor.text, 'New text');
  assert.equal(next.getState().drafts.draft.submission, undefined);
  next.getState().accepted('draft', 4);
  assert.equal(next.getState().drafts.draft, undefined);
});

test('knowledge selection and scope survive mode switches, reload and submission failure', () => {
  const data = new Map();
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
  const first = createHomeDraftStore(() => storage);
  first.getState().edit('draft', { text: 'Find source evidence', references: [] });
  first
    .getState()
    .controls('draft', { workMode: 'knowledge', knowledge: { collectionIds: ['source-a', 'source-b'] } });
  first.getState().controls('draft', { workMode: 'plan' });
  first.getState().controls('draft', { workMode: 'knowledge' });
  const draft = first.getState().drafts.draft;
  first
    .getState()
    .submission('draft', {
      submissionId: 'request',
      draftId: 'draft',
      draftVersion: draft.version,
      controls: draft.controls,
    });
  const restored = createHomeDraftStore(() => storage);
  assert.deepEqual(restored.getState().drafts.draft.submission.controls, draft.controls);
  restored.getState().submission('draft', undefined);
  assert.deepEqual(restored.getState().drafts.draft.controls.knowledge.collectionIds, [
    'source-a',
    'source-b',
  ]);
  assert.equal(restored.getState().drafts.draft.editor.text, 'Find source evidence');
});
