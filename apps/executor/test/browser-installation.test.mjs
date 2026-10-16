/**
 * @author Codex
 * @description Verifies fixed setup argument handling, failure propagation and bundled extension containment without changing browser registration.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
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
  'fixed setup preserves spaced Unicode paths and rejects unsuccessful scripts without registry writes',
  { skip: process.platform !== 'win32' },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'octopus-browser-setup-'));
    try {
      const resources = join(root, '资源 & bundle');
      const data = join(root, '用户 data');
      await mkdir(join(resources, 'setup'), { recursive: true });
      await mkdir(data);
      const script = join(resources, 'setup/register-browser-host.ps1');
      await writeFile(
        script,
        '\uFEFFparam([string]$Mode,[string]$ResourceRoot,[string]$ProjectRoot,[switch]$MigrateProduct)\r\n@{mode=$Mode;resource=$ResourceRoot;data=$ProjectRoot;migrate=[bool]$MigrateProduct} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $ProjectRoot "arguments.json") -Encoding UTF8\r\n'
      );
      await configureBrowserHost(resources, data);
      const actual = JSON.parse(
        (await readFile(join(data, 'arguments.json'), 'utf8')).replace(/^\uFEFF/, '')
      );
      assert.deepEqual(actual, { mode: 'install', resource: resources, data, migrate: true });
      await writeFile(script, 'exit 1');
      await assert.rejects(configureBrowserHost(resources, data));
      const cancelled = new AbortController();
      cancelled.abort();
      await assert.rejects(configureBrowserHost(resources, data, cancelled.signal));
    } finally {
      assert.ok(resolve(root).startsWith(resolve(tmpdir()) + '\\'));
      await rm(root, { recursive: true, force: true });
    }
  }
);
