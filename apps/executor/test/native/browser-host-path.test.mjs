/**
 * @author Codex
 * @description Verifies shared Host directory resolution preserves physical private identity and rejects non-directory inputs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';
import { browserHostDirectory } from '../../src/installation/windows/browser-host-platform.ts';

test('Host directory resolution preserves private identity across aliases and rejects files, missing and relative paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-host-path-'));
  const native = new NativeFileCommit(
    fileURLToPath(new URL('../../dist/native/file-commit.node', import.meta.url))
  );
  const data = join(root, '.octopus-executor-recovery-设备 browser');
  try {
    assert.equal((await native.createRecovery(data)).ok, true);
    const alias = join(root, 'alias');
    await symlink(data, alias, 'junction');
    const resolved = await browserHostDirectory(alias);
    assert.match(resolved, /^[A-Za-z]:\\/);
    const before = await native.inspect(data);
    const after = await native.inspect(resolved);
    assert.equal(after.ok, true);
    assert.equal(after.privateAcl, true);
    assert.equal(after.identity, before.identity);
    const file = join(root, 'file');
    await writeFile(file, 'fixture');
    await assert.rejects(browserHostDirectory(file), /HOST_LOCAL_DIRECTORY_REQUIRED/);
    await assert.rejects(browserHostDirectory(join(root, 'missing')));
    await assert.rejects(browserHostDirectory('relative'), /HOST_LOCAL_DIRECTORY_REQUIRED/);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
  }
});
