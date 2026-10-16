/**
 * @author Codex
 * @description Verifies credential export protection before content writes, no-clobber and reparse refusal.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';

test('private configuration is SID-protected, flushed, bounded and never overwrites or follows reparses', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-private-config-'));
  const native = new NativeFileCommit(
    fileURLToPath(new URL('../../dist/native/file-commit.node', import.meta.url))
  );
  try {
    const path = join(root, 'connection.json');
    const text = JSON.stringify({ label: '中文', credential: 'test-only-secret' }) + '\n';
    const written = await native.writePrivateConfig(path, text);
    assert.equal(written.ok, true);
    assert.equal(written.privateAcl, true);
    assert.equal((await native.inspect(path)).privateAcl, true);
    assert.equal(await readFile(path, 'utf8'), text);
    assert.equal((await native.writePrivateConfig(path, 'replacement')).ok, false);
    assert.equal(await readFile(path, 'utf8'), text);
    const outside = join(root, 'outside');
    await mkdir(outside);
    await symlink(outside, join(root, 'escape'), 'junction');
    assert.equal((await native.writePrivateConfig(join(root, 'escape', 'secret.json'), text)).ok, false);
    await assert.rejects(readFile(join(outside, 'secret.json')), { code: 'ENOENT' });
    await assert.rejects(native.writePrivateConfig(join(root, 'large.json'), 'x'.repeat(30001)), {
      code: 'INVALID_CONFIG',
    });
  } finally {
    assert.ok(root.startsWith(join(tmpdir(), 'octopus-private-config-')));
    await rm(root, { recursive: true, force: true });
  }
});
