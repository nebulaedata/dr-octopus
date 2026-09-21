/**
 * @author Codex
 * @description 验证浏览器与 Server 共享协议的版本导出
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { OCTOPUS_PROTOCOL_VERSION, WorkspaceReferencesSchema } from '../dist/protocol/index.js';

test('realtime protocol exposes a stable positive version', () => {
  assert.equal(OCTOPUS_PROTOCOL_VERSION, 5);
});

test('Workspace reference protocol accepts only bounded file and directory paths', () => {
  assert.equal(WorkspaceReferencesSchema.safeParse([{ kind: 'file', path: 'src/index.ts' }]).success, true);
  assert.equal(WorkspaceReferencesSchema.safeParse([{ kind: 'link', path: 'src/index.ts' }]).success, false);
  assert.equal(WorkspaceReferencesSchema.safeParse([{ kind: 'file', path: '' }]).success, false);
  assert.equal(
    WorkspaceReferencesSchema.safeParse(
      Array.from({ length: 33 }, (_, index) => ({ kind: 'file', path: `${index}.ts` }))
    ).success,
    false
  );
});
