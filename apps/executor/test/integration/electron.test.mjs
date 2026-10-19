/**
 * @author Codex
 * @description Exercises built Electron sandbox, IPC authorization, window-independent Runtime and confirmed exits.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { _electron as electron, expect } from '@playwright/test';

const appRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));

/**
 * Launches only this built app in a hidden window with a disposable user-data root.
 */
async function launch(prepareData) {
  const data = await mkdtemp(join(tmpdir(), 'octopus-executor-integration-'));
  try {
    await mkdir(join(data, 'project'));
    if (prepareData) {
      await prepareData(data);
    }
    const app = await electron.launch({
      cwd: appRoot,
      args: [appRoot, '--executor-test', '--executor-test-data=' + data],
      timeout: 30_000,
    });
    return { app, data };
  } catch (error) {
    await rm(data, { recursive: true, force: true });
    throw error;
  }
}

test(
  'invalid recovery journal prevents production Runtime readiness and leaves Basic unavailable',
  { timeout: 60_000 },
  async () => {
    const { app, data } = await launch(async (root) => {
      const binary = join(appRoot, 'dist', 'native', 'file-commit.node');
      const native = createRequire(binary)(binary);
      const journal = join(root, 'project', 'file-operations');
      assert.equal((await native.createRecovery(journal)).ok, true);
      await writeFile(join(journal, '00000000-0000-0000-0000-000000000000.jsonl'), '{broken');
    });
    try {
      const page = await app.firstWindow();
      await page.waitForFunction(async () => (await window.executor.readStatus()).data?.state === 'failed');
      const status = await page.evaluate(async () => (await window.executor.readStatus()).data);
      assert.equal(status.pid, null);
      assert.equal(status.capabilities.basic.available, false);
    } finally {
      await app.close();
      await rm(data, { recursive: true, force: true });
    }
  }
);

/**
 * Verifies that corrupt Shell storage prevents the production Runtime from becoming ready.
 */
test(
  'invalid shell history prevents production Runtime readiness and leaves Basic unavailable',
  { timeout: 60000 },
  async () => {
    const { app, data } = await launch(async (root) => {
      const binary = join(appRoot, 'dist', 'native', 'file-commit.node');
      const native = createRequire(binary)(binary);
      const journal = join(root, 'project', 'shell');
      assert.equal((await native.createRecovery(journal)).ok, true);
      await writeFile(join(journal, '00000000-0000-0000-0000-000000000000.jsonl'), '{broken\n');
    });
    try {
      const page = await app.firstWindow();
      await page.waitForFunction(async () => (await window.executor.readStatus()).data?.state === 'failed');
      const status = await page.evaluate(async () => (await window.executor.readStatus()).data);
      assert.equal(status.pid, null);
      assert.equal(status.capabilities.basic.available, false);
    } finally {
      await app.close();
      await rm(data, { recursive: true, force: true });
    }
  }
);

/**
 * Confirms that the owned Utility Process PID no longer exists.
 */
async function assertExited(pid) {
  assert.ok(Number.isInteger(pid) && pid > 0, 'Process checks require a captured owned PID.');
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') {
        return;
      }
      throw error;
    }
    await delay(100);
  }
  assert.fail('Owned Runtime PID is still alive: ' + pid);
}

/**
 * Captures readiness and numeric identity in the same response under a finite polling deadline.
 */
async function readyPid(page) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const status = await page.evaluate(async () => (await window.executor.readStatus()).data);
    if (status?.state === 'ready' && Number.isInteger(status.pid) && status.pid > 0) {
      return status.pid;
    }
    assert.notEqual(status?.state, 'failed', status?.message);
    await delay(25);
  }
  assert.fail('Runtime readiness was not confirmed within the test deadline.');
}

test(
  'built app preserves sandbox and IPC boundaries, recreates UI, and drains Runtime',
  { timeout: 60_000 },
  async () => {
    const { app, data } = await launch();
    let runtimePid;
    try {
      const page = await app.firstWindow();
      const errors = [];
      page.on('pageerror', (error) => {
        errors.push(error.message);
      });
      await page.waitForFunction(
        async () => window.executor && (await window.executor.readStatus()).data?.state === 'ready'
      );
      await page.getByRole('heading', { name: '运行状态' }).waitFor();
      assert.equal(
        await page
          .getByRole('heading', { name: '运行状态' })
          .evaluate((element) => getComputedStyle(element).fontSize),
        '30px'
      );
      await page.getByTestId('runtime-state').filter({ hasText: '已启动' }).waitFor();
      const security = await app.evaluate(({ BrowserWindow }) => {
        const preferences = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
        return {
          sandbox: preferences.sandbox,
          contextIsolation: preferences.contextIsolation,
          nodeIntegration: preferences.nodeIntegration,
        };
      });
      assert.deepEqual(security, { sandbox: true, contextIsolation: true, nodeIntegration: false });
      assert.deepEqual(
        await page.evaluate(() => ({
          node: typeof window.require,
          process: typeof window.process,
          keys: Object.keys(window.executor).sort(),
        })),
        {
          node: 'undefined',
          process: 'undefined',
          keys: [
            'approveAccess',
            'browserDiagnostics',
            'configureBrowserHost',
            'copyAgentGuide',
            'copyClientConfiguration',
            'copyEndpoint',
            'downloadClientConfiguration',
            'maintenanceAction',
            'onStatusChanged',
            'openBrowserExtensionFolder',
            'readAccess',
            'readClientConfiguration',
            'readMaintenance',
            'readSettings',
            'readStatus',
            'restartApplication',
            'revokeAccess',
            'saveSettings',
            'setBrowserEnabled',
          ],
        }
      );
      const status = await page.evaluate(() => window.executor.readStatus());
      runtimePid = status.data.pid;
      assert.notEqual(runtimePid, app.process().pid);
      assert.equal(status.data.capabilities.basic.available, true);
      assert.equal(status.data.capabilities.browser.available, false);
      await expect
        .poll(
          () =>
            page.evaluate(
              async () => (await window.executor.readStatus()).data?.capabilities.computer.available
            ),
          { timeout: 45000 }
        )
        .toBe(true);
      assert.equal(
        (await page.evaluate(() => window.executor.readStatus())).data.capabilities.computer.state,
        'ready'
      );
      // An unregistered window has the same real Preload and trusted origin, but no authorization.
      await app.evaluate(
        async ({ BrowserWindow }, preload) => {
          const extra = new BrowserWindow({
            show: false,
            webPreferences: {
              preload,
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false,
            },
          });
          await extra.loadURL('app://ui/index.html');
        },
        join(appRoot, 'dist/preload/index.cjs')
      );
      const unauthorized = app.windows().find((candidate) => candidate !== page);
      await unauthorized.waitForFunction(() => Boolean(window.executor));
      assert.equal((await unauthorized.evaluate(() => window.executor.readStatus())).code, 'FORBIDDEN');
      assert.equal((await unauthorized.evaluate(() => window.executor.readMaintenance())).ok, false);
      assert.equal(
        (
          await unauthorized.evaluate(() =>
            window.executor.maintenanceAction({ action: 'reset', revision: 0 })
          )
        ).ok,
        false
      );
      assert.equal((await unauthorized.evaluate(() => window.executor.configureBrowserHost())).ok, false);
      assert.equal(
        (await unauthorized.evaluate(() => window.executor.openBrowserExtensionFolder({ browser: 'chrome' })))
          .ok,
        false
      );
      const invalidSetup = await app.evaluate(async ({ ipcMain, BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
        const setup = ipcMain._invokeHandlers.get('executor:browser:configure-host');
        const folder = ipcMain._invokeHandlers.get('executor:browser:open-extension-folder');
        return [
          await setup(event, { script: 'foreign.ps1' }),
          await folder(event, { browser: '../foreign' }),
        ];
      });
      assert.ok(invalidSetup.every((reply) => !reply.ok));
      const closedWindows = Promise.all(app.windows().map((window) => window.waitForEvent('close')));
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows().forEach((window) => window.destroy());
      });
      await closedWindows;
      assert.doesNotThrow(() => process.kill(runtimePid, 0));
      const nextWindow = app.waitForEvent('window');
      await app.evaluate(({ app }) => {
        app.emit('activate');
      });
      const recreated = await nextWindow;
      await recreated.waitForFunction(() => Boolean(window.executor));
      assert.equal((await recreated.evaluate(() => window.executor.readStatus())).data.pid, runtimePid);
      assert.deepEqual(errors, []);
      await app.close();
      await assertExited(runtimePid);
    } finally {
      await app.close().catch(() => {});
      await rm(data, { recursive: true, force: true });
    }
  }
);

test(
  'unexpected Runtime exit publishes failure without replay or automatic restart',
  { timeout: 60_000 },
  async () => {
    const { app, data } = await launch();
    try {
      const page = await app.firstWindow();
      const pid = await readyPid(page);
      await page.evaluate(() => {
        window.observed = { removed: 0, retained: 0 };
        const remove = window.executor.onStatusChanged(() => {
          window.observed.removed++;
        });
        window.executor.onStatusChanged(() => {
          window.observed.retained++;
        });
        remove();
        remove();
      });
      process.kill(pid);
      await page.getByTestId('runtime-state').filter({ hasText: '异常' }).waitFor();
      const failed = await page.evaluate(() => window.executor.readStatus());
      assert.equal(failed.data.state, 'failed');
      assert.equal(failed.data.pid, null);
      const observed = await page.evaluate(() => window.observed);
      assert.equal(observed.removed, 0);
      assert.ok(observed.retained > 0);
      await assertExited(pid);
    } finally {
      await app.close().catch(() => {});
      await rm(data, { recursive: true, force: true });
    }
  }
);

test('abrupt Main exit does not orphan its Utility Runtime', { timeout: 60_000 }, async () => {
  const { app, data } = await launch();
  try {
    const page = await app.firstWindow();
    const pid = await readyPid(page);
    const mainPid = await app.evaluate(() => process.pid);
    process.kill(mainPid);
    await assertExited(pid);
  } finally {
    await app.close().catch(() => {});
    await rm(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
