/**
 * @author Codex
 * @description Verifies recovery retains structured mentions and visible text instead of degrading references into plain text.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { toComposerAttachment } from '../src/features/session/utils/attachment-projection.ts';
import { createEditor } from 'lexical';
import { restoreComposerDraft } from '../src/components/AgentComposerEditor/restore-draft.ts';
import { FileMentionNode } from '../src/components/AgentComposerEditor/plugins/workspace-mentions-plugin/file-mention-node.ts';
import { $buildComposerDraft } from '../src/components/AgentComposerEditor/plugins/composer-draft.ts';

test('recovery round-trips mentions, whitespace and overlapping paths through Lexical', () => {
  const references = ['docs', 'docs/guide.md'].map((path) => ({
    path,
    label: path,
    kind: path === 'docs' ? 'directory' : 'file',
  }));
  const draft = restoreComposerDraft('Read @docs/guide.md\nthen @docs', references);
  const editor = createEditor({
    nodes: [FileMentionNode],
    onError: (error) => {
      throw error;
    },
  });
  const state = editor.parseEditorState(draft.editorState);
  const restored = state.read($buildComposerDraft);
  assert.equal(restored.text, 'Read @docs/guide.md\nthen @docs');
  assert.deepEqual(
    restored.references.map((item) => item.path),
    ['docs/guide.md', 'docs']
  );
});

test('explicit references absent from the saved text remain visible and editable', () => {
  const draft = restoreComposerDraft('Explain this', [{ path: 'notes.md', kind: 'file', label: 'notes.md' }]);
  assert.equal(draft.text, 'Explain this @notes.md');
  assert.equal(draft.references[0].path, 'notes.md');
});

test('an authoritative attachment tombstone is removable instead of looking like a pending delete forever', () => {
  const attachment = toComposerAttachment({
    id: 'removed',
    name: 'removed.txt',
    byteSize: 10,
    revision: 2,
    status: 'deleted',
  });
  assert.equal(attachment.status, 'rejected');
  assert.equal(attachment.revision, 2);
});
