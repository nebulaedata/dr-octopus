/**
 * @author Codex
 * @description Tests pure protocol/resource boundaries against hostile inputs without launching Electron.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resolveUiAsset } from '../src/main/resource-paths.ts';
import { emptyRequestSchema, runtimeMessageSchema, statusResponseSchema } from '../src/contracts/runtime.ts';

test('UI assets reject wrong origins, encoded traversal and malformed paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-assets-'));
  try {
    await writeFile(join(root, 'index.html'), '<html></html>');
    assert.equal(await resolveUiAsset(root, 'app://ui/'), join(root, 'index.html'));
    for (const url of [
      'https://ui/',
      'app://evil/',
      'app://user@ui/',
      'app://ui:123/',
      'app://ui/?file=x',
      'app://ui/%2e%2e%5csecret',
      'app://ui/%2f..%2fsecret',
      'app://ui/%00',
      'app://ui/%zz',
      'app://ui/missing.js',
    ]) {
      assert.equal(await resolveUiAsset(root, url), null, url);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('UI assets reject an existing directory junction outside the resource root', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'octopus-asset-junction-'));
  const root = join(fixture, 'ui');
  const outside = join(fixture, 'outside');
  try {
    await mkdir(root);
    await mkdir(outside);
    await writeFile(join(outside, 'secret.txt'), 'private');
    await symlink(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(await resolveUiAsset(root, 'app://ui/escape/secret.txt'), null);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test('named IPC schemas reject extra parameters and forged Runtime readiness', () => {
  assert.equal(emptyRequestSchema.safeParse({ command: 'arbitrary' }).success, false);
  assert.equal(
    runtimeMessageSchema.safeParse({ type: 'ready', pid: -1, startedAt: new Date().toISOString() }).success,
    false
  );
  assert.equal(runtimeMessageSchema.safeParse({ type: 'shutdown', shell: 'anything' }).success, false);
  assert.equal(
    statusResponseSchema.safeParse({ ok: false, code: 'FORBIDDEN', message: 'denied', stack: 'secret' })
      .success,
    false
  );
});
