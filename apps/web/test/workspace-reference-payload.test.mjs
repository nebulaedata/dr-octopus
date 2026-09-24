/**
 * @author Codex
 * @description Verifies Lexical mention metadata becomes a stable Workspace reference payload.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { toWorkspaceReferences } from '../src/features/session/utils/workspace-reference-payload.ts';

test('Workspace reference payload preserves order, kind, and path while removing labels and duplicates', () => {
  assert.deepEqual(
    toWorkspaceReferences([
      { kind: 'file', path: 'src/a.ts', label: 'a.ts' },
      { kind: 'file', path: 'src/a.ts', label: 'renamed display' },
      { kind: 'directory', path: 'src', label: 'src' },
    ]),
    [
      { kind: 'file', path: 'src/a.ts' },
      { kind: 'directory', path: 'src' },
    ]
  );
});
