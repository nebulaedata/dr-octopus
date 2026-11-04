/**
 * @author Codex
 * @description Verifies fixed setup argument handling, failure propagation and bundled extension containment without changing browser registration.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, access, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { browserExtensionFolder, configureBrowserHost } from '../src/main/browser-installation.ts';

test('local extension selection rejects missing manifests and escaped directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-extension-install-'));
  try {
    const bundle = join(root, 'browser');
    await mkdir(join(bundle, 'chrome'), { recursive: true });
    await assert.rejects(browserExtensionFolder(bundle, 'chrome'));
    await writeFile(join(bundle, 'chrome/manifest.json'), '{}');
    assert.equal(await browserExtensionFolder(bundle, 'chrome'), join(bundle, 'chrome'));
    await mkdir(join(root, 'foreign'));
    await writeFile(join(root, 'foreign/manifest.json'), '{}');
    await symlink(
      join(root, 'foreign'),
      join(bundle, 'edge'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    await assert.rejects(browserExtensionFolder(bundle, 'edge'), /outside bundle/);
  } finally {
    assert.ok(
      resolve(root).startsWith(resolve(tmpdir()) + '\\') || resolve(root).startsWith(resolve(tmpdir()) + '/')
    );
    await rm(root, { recursive: true, force: true });
  }
});

test(
  'maintenance rejects missing fixed launchers and cancellation before creating data',
  { skip: process.platform !== 'win32' },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'octopus-browser-setup-'));
    const data = join(root, '用户 data');
    try {
      await assert.rejects(configureBrowserHost(root, data), { code: 'ENOENT' });
      const cancelled = new AbortController();
      cancelled.abort();
      await assert.rejects(configureBrowserHost(root, data, cancelled.signal), { name: 'AbortError' });
      await assert.rejects(access(data), { code: 'ENOENT' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);
