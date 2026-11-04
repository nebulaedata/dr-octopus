/**
 * @author Codex
 * @description Verifies current owner changes, explicit foreign-registration confirmation and old uninstall protection using one unique test Host.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { hostBundlePaths } from '../../src/contracts/browser-host-bundle.ts';
import { BrowserHostMaintenance } from '../../src/maintenance/browser-host.ts';
import { windowsBrowserRegistry } from '../../src/installation/windows/browser-host-platform.ts';
import { configureBrowserHost } from '../../src/main/browser-installation.ts';
const run = promisify(execFile);
const dist = fileURLToPath(new URL('../../dist/', import.meta.url));
const powershell = join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');

test(
  'new owner survives old uninstall; foreign registrations require a current explicit confirmation',
  { timeout: 90000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'octopus-host-ownership-'));
    const old = join(root, '旧 bundle');
    const current = join(root, '新 bundle');
    const data = join(root, '用户 data');
    const manifest = join(data, 'browser-host/registration/native-host.json');
    const foreign = join(root, 'deleted-foreign.json');
    const hostName = `com.octopus.executor.browser.dev_${randomBytes(8).toString('hex')}`;
    await mkdir(data);
    const original = JSON.parse(await readFile(join(dist, 'host-bundle.json'), 'utf8'));
    const registry = windowsBrowserRegistry(current);
    /**
     * Invokes the unchanged removal entrypoint with only fixture-owned source and data roots.
     */
    async function remove(source) {
      await run(
        powershell,
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          join(source, 'setup/register-browser-host.ps1'),
          '-Mode',
          'remove',
          '-ResourceRoot',
          source,
          '-ProjectRoot',
          data,
        ],
        { windowsHide: true, timeout: 60000 }
      );
    }
    try {
      for (const [source, version] of [
        [old, '1.0.0'],
        [current, '2.0.0'],
      ]) {
        for (const file of hostBundlePaths) {
          await mkdir(dirname(join(source, file)), { recursive: true });
          await copyFile(join(dist, file), join(source, file));
        }
        await writeFile(join(source, 'host-bundle.json'), JSON.stringify({ ...original, version, hostName }));
      }
      assert.equal((await configureBrowserHost(old, data)).phase, 'ready');
      assert.equal((await configureBrowserHost(current, data)).phase, 'ready');
      await remove(old);
      assert(
        (await registry.inspect(hostName))
          .filter((item) => item.hive === 'CurrentUser')
          .every((item) => item.path === manifest)
      );
      await assert.rejects(configureBrowserHost(old, data), /HOST_CONFIRMATION_REQUIRED/);
      const own = JSON.parse(await readFile(manifest, 'utf8'));
      await writeFile(manifest, JSON.stringify({ ...own, allowed_origins: ['chrome-extension://foreign/'] }));
      assert.equal((await configureBrowserHost(current, data)).phase, 'ready');
      assert.deepEqual(JSON.parse(await readFile(manifest, 'utf8')).allowed_origins, original.origins);
      const record = (await registry.inspect(hostName)).find(
        (item) => item.browser === 'chrome' && item.hive === 'CurrentUser' && item.view === 'Registry32'
      );
      await registry.set(hostName, record, foreign);
      await assert.rejects(configureBrowserHost(current, data), /HOST_CONFIRMATION_REQUIRED/);
      const evidence = await new BrowserHostMaintenance(current, data, registry).inspect();
      assert.equal(evidence.phase, 'confirmationRequired');
      assert.equal(
        (
          await configureBrowserHost(current, data, undefined, {
            revision: evidence.revision,
            confirmReplacement: true,
          })
        ).phase,
        'ready'
      );
      const backup = JSON.parse(
        await readFile(join(data, 'browser-host/state/last-transaction.json'), 'utf8')
      );
      assert(backup.before.some((item) => item.path === foreign));
      await remove(current);
      assert((await registry.inspect(hostName)).every((item) => item.path === null));
    } finally {
      for (const record of (await registry.inspect(hostName).catch(() => [])).filter(
        (item) => item.hive === 'CurrentUser'
      )) {
        if ([manifest, foreign].includes(record.path)) {
          await registry.remove(hostName, record, record.path);
        }
      }
      await rm(root, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
    }
  }
);
