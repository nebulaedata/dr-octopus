/**
 * @author Codex
 * @description Verifies packaged diagnostics reuse maintenance facts, preserve registrations, and redact fixture paths.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { hostBundlePaths } from '../../src/contracts/browser-host-bundle.ts';
import { windowsBrowserRegistry } from '../../src/installation/windows/browser-host-platform.ts';
import { configureBrowserHost } from '../../src/main/browser-installation.ts';
const run = promisify(execFile);
const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const powershell = join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');

test(
  'packaged Host diagnostics share integrity evidence, redact paths and never change registrations',
  { timeout: 60000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'octopus-host-diagnostics-'));
    const product = join(root, '用户 bundle');
    const resource = join(product, 'resources/executor');
    const data = join(root, 'data');
    await mkdir(data);
    const bundle = JSON.parse(await readFile(join(appRoot, 'dist/host-bundle.json'), 'utf8'));
    bundle.hostName = `com.octopus.executor.browser.dev_${randomBytes(8).toString('hex')}`;
    const registry = windowsBrowserRegistry(resource);
    const manifestPath = join(data, 'browser-host/registration/native-host.json');
    /**
     * Runs the shipped read-only probe against only the unique fixture Host and returns its safe report.
     */
    async function diagnose(name) {
      const report = join(root, name + '.json');
      await run(
        powershell,
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          join(appRoot, 'test/packaging/diagnose-browser-host.ps1'),
          '-ProductDirectory',
          product,
          '-ProjectRoot',
          data,
          '-ReportPath',
          report,
        ],
        { windowsHide: true, timeout: 15000 }
      );
      const text = await readFile(report, 'utf8');
      assert(!text.includes(root));
      assert(!text.includes('projectRoot'));
      return JSON.parse(text);
    }
    try {
      for (const file of hostBundlePaths) {
        await mkdir(dirname(join(resource, file)), { recursive: true });
        await copyFile(join(appRoot, 'dist', file), join(resource, file));
      }
      await writeFile(join(resource, 'host-bundle.json'), JSON.stringify(bundle));
      const before = await registry.inspect(bundle.hostName);
      assert.equal((await diagnose('missing')).phase, 'repairable');
      assert.deepEqual(await registry.inspect(bundle.hostName), before);
      assert.equal((await configureBrowserHost(resource, data)).phase, 'ready');
      assert.equal((await diagnose('valid')).phase, 'ready');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      await writeFile(manifestPath, JSON.stringify({ ...manifest, allowed_origins: [] }));
      const registered = await registry.inspect(bundle.hostName);
      const invalid = await diagnose('invalid');
      assert.equal(invalid.phase, 'repairable');
      assert(invalid.checks.some((item) => item.code === 'MANIFEST_INVALID'));
      assert.deepEqual(await registry.inspect(bundle.hostName), registered);
    } finally {
      for (const record of (await registry.inspect(bundle.hostName).catch(() => [])).filter(
        (item) => item.hive === 'CurrentUser'
      )) {
        await registry.remove(bundle.hostName, record, manifestPath);
      }
      await rm(root, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
    }
  }
);
