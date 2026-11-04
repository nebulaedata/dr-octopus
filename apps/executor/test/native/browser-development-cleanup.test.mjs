/**
 * @author Codex
 * @description Verifies explicit development cleanup removes only matching isolated registrations and shares the native maintenance mutex.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { windowsBrowserRegistry } from '../../src/installation/windows/browser-host-platform.ts';
import { browserDigest } from '../../src/maintenance/browser-host.ts';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const execute = promisify(execFile);
test(
  'developer cleanup refuses busy or foreign registrations and retains all user data',
  { timeout: 45000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'octopus-dev-cleanup-'));
    const key = randomBytes(8).toString('hex');
    const host = `com.octopus.executor.browser.dev_${key}`;
    const expected = join(root, key, 'electron/project/browser-host/registration/native-host.json');
    const foreign = join(root, 'foreign.json');
    const registry = windowsBrowserRegistry(join(appRoot, 'dist'));
    const native = createRequire(import.meta.url)(join(appRoot, 'dist/native/file-commit.node'));
    /**
     * Invokes the source-owned finite cleanup tool against only the test namespace.
     */
    async function cleanup() {
      return execute(
        join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          join(appRoot, 'src/installation/windows/remove-development-host.ps1'),
          '-WorkspaceKey',
          key,
          '-ExpectedManifest',
          expected,
        ],
        { windowsHide: true, timeout: 10000 }
      );
    }
    try {
      for (const record of (await registry.inspect(host)).filter((item) => item.hive === 'CurrentUser')) {
        await registry.set(host, record, expected);
      }
      const lease = native.lockMaintenance(browserDigest(host));
      try {
        await assert.rejects(cleanup(), /busy/);
      } finally {
        native.releaseMaintenance(lease);
      }
      await cleanup();
      assert((await registry.inspect(host)).every((item) => item.path === null));
      const record = (await registry.inspect(host)).find((item) => item.hive === 'CurrentUser');
      await registry.set(host, record, foreign);
      await assert.rejects(cleanup(), (error) => error.code === 2);
      assert((await registry.inspect(host)).some((item) => item.path === foreign));
    } finally {
      for (const record of (await registry.inspect(host)).filter((item) => item.hive === 'CurrentUser')) {
        if ([expected, foreign].includes(record.path)) {
          await registry.remove(host, record, record.path);
        }
      }
      await rm(root, { recursive: true, force: true });
    }
  }
);
