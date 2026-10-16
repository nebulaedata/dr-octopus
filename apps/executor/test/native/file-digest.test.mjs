/**
 * @author Codex
 * @description Verifies exact bounded SHA-256 from pinned ordinary NTFS handles, including sharing and alias refusals.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm, open, link, symlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';
const native = new NativeFileCommit(
  fileURLToPath(new URL('../../dist/native/file-commit.node', import.meta.url))
);

test('native digest hashes empty, Unicode and multi-chunk bytes without copying content to JavaScript', async () => {
  const prefix = join(tmpdir(), 'octopus-file-digest-');
  const root = await mkdtemp(prefix);
  try {
    for (const bytes of [
      Buffer.alloc(0),
      Buffer.from('中文\0binary'),
      Buffer.alloc(2 * 1024 * 1024 + 19, 0xa7),
    ]) {
      const path = join(root, 'fixture.dat');
      await writeFile(path, bytes);
      const result = await native.readDigest(path, bytes.length);
      assert.equal(result.ok, true);
      assert.equal(result.links, 1);
      assert.equal(result.size, bytes.length);
      assert.equal(result.digest, createHash('sha256').update(bytes).digest('hex'));
      assert.equal('bytes' in result, false);
      assert.equal((await native.readDigest(path, bytes.length + 1)).ok, false);
    }
  } finally {
    assert.ok(root.startsWith(prefix));
    await rm(root, { recursive: true, force: true });
  }
});

test('native digest refuses size limits, writable sharing, hard links, directories and ancestor reparses', async () => {
  const prefix = join(tmpdir(), 'octopus-file-digest-');
  const root = await mkdtemp(prefix);
  try {
    const directory = join(root, 'owned');
    await mkdir(directory);
    const path = join(directory, 'fixture.dat');
    await writeFile(path, 'test');
    const privatePath = join(directory, 'protected.json');
    assert.equal((await native.writePrivateConfig(privatePath, '{}')).ok, true);
    const privateDigest = await native.readDigest(privatePath, 2);
    assert.equal(privateDigest.ok, true);
    assert.equal(
      privateDigest.privateAcl,
      true,
      'Digest output must still inspect the actual final file ACL.'
    );
    for (const size of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 64 * 1024 * 1024 + 1]) {
      await assert.rejects(native.readDigest(path, size));
    }
    const writer = await open(path, 'r+');
    try {
      const blocked = await native.readDigest(path, 4);
      assert.equal(blocked.ok, false);
      assert.equal(blocked.nativeCode, 32);
    } finally {
      await writer.close();
    }
    assert.equal((await native.readDigest(path, 4)).ok, true);
    await link(path, join(root, 'hardlink.dat'));
    assert.equal((await native.readDigest(path, 4)).ok, false);
    await rm(join(root, 'hardlink.dat'));
    const alias = join(root, 'junction');
    await symlink(directory, alias, 'junction');
    assert.equal((await native.readDigest(join(alias, 'fixture.dat'), 4)).ok, false);
    assert.equal((await native.readDigest(directory, 0)).ok, false);
  } finally {
    assert.ok(root.startsWith(prefix));
    await rm(root, { recursive: true, force: true });
  }
});

test('concurrent native digests keep independent SHA-256 states across reused system algorithm handles', async () => {
  const prefix = join(tmpdir(), 'octopus-concurrent-digest-');
  const root = await mkdtemp(prefix);
  try {
    const files = await Promise.all(
      Array.from({ length: 16 }, async (_, index) => {
        const bytes = Buffer.alloc(index * 10001, index + 1);
        const path = join(root, `fixture-${index}.dat`);
        await writeFile(path, bytes);
        return { path, size: bytes.length, hash: createHash('sha256').update(bytes).digest('hex') };
      })
    );
    for (let index = 0; index < files.length; index += 4) {
      await Promise.all(
        files.slice(index, index + 4).map(async (file) => {
          const result = await native.readDigest(file.path, file.size);
          assert.equal(result.ok, true);
          assert.equal(result.digest, file.hash);
        })
      );
    }
  } finally {
    assert.ok(root.startsWith(prefix));
    await rm(root, { recursive: true, force: true });
  }
});
