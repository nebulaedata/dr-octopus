/**
 * @author Codex
 * @description Verifies Workspace mention ordering stays aligned with the grouped typeahead presentation.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWorkspaceReferenceCatalog } from '../src/components/AgentComposerEditor/plugins/workspace-mentions-plugin/workspace-reference-catalog.ts';

test('orders the Lexical options in the same file-then-folder sequence rendered by the menu', () => {
  const references = [
    { kind: 'file', label: 'alpha.txt', path: 'alpha.txt' },
    { kind: 'directory', label: 'apps', path: 'apps' },
    { kind: 'file', label: 'bravo.txt', path: 'bravo.txt' },
    { kind: 'directory', label: 'web', path: 'apps/web' },
  ];

  const result = buildWorkspaceReferenceCatalog(references, null, 8);

  assert.deepEqual(
    result.map((reference) => `${reference.kind}:${reference.path}`),
    ['file:alpha.txt', 'file:bravo.txt', 'directory:apps', 'directory:apps/web']
  );
});

test('keeps the original relevance-ranked candidate set before aligning visual groups', () => {
  const references = [
    { kind: 'directory', label: 'src', path: 'src' },
    { kind: 'file', label: 'src-notes.txt', path: 'notes/src-notes.txt' },
    { kind: 'file', label: 'src-index.ts', path: 'src-index.ts' },
  ];

  const result = buildWorkspaceReferenceCatalog(references, 'src', 2);

  assert.deepEqual(
    result.map((reference) => reference.path),
    ['src-index.ts', 'src']
  );
});
