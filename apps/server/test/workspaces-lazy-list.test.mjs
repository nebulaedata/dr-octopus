/**
 * @author Codex
 * @description Ensures Workspace listing reads exactly the requested directory without probing descendants.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { resolve } from 'node:path';
import { WorkspacesService } from '../dist/modules/workspaces/workspaces.service.js';

/**
 * Supplies the Dirent fields consumed by a directory listing.
 */
function entry(name, directory) {
  return { name, isDirectory: () => directory };
}

test('listing reads only the requested directory and never probes child directories', async (t) => {
  const root = resolve('lazy-workspace');
  const reads = [];
  const mock = t.mock.method(fs, 'readdir', async (path, options) => {
    reads.push(path);
    assert.deepEqual(options, { withFileTypes: true });
    if (path === root) return [entry('z.txt', false), entry('src', true), entry('empty', true)];
    if (path === resolve(root, 'src')) return [entry('deep', true), entry('main.ts', false)];
    throw new Error('An unrequested directory was accessed');
  });
  syncBuiltinESMExports();
  t.after(() => {
    mock.mock.restore();
    syncBuiltinESMExports();
  });
  const service = new WorkspacesService({}, { workspaceBackend: { resolve: async () => ({ cwd: root }) } });
  assert.deepEqual(await service.listEntries('workspace', ''), [
    { name: 'empty', path: 'empty', type: 'directory' },
    { name: 'src', path: 'src', type: 'directory' },
    { name: 'z.txt', path: 'z.txt', type: 'file' },
  ]);
  assert.deepEqual(reads, [root]);
  assert.deepEqual(await service.listEntries('workspace', 'src'), [
    { name: 'deep', path: 'src/deep', type: 'directory' },
    { name: 'main.ts', path: 'src/main.ts', type: 'file' },
  ]);
  assert.deepEqual(reads, [root, resolve(root, 'src')]);
});
