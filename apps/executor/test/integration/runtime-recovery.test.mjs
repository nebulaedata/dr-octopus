/**
 * @author Codex
 * @description Exercises old-data failure, Alert actions, cancellation and actual Runtime recovery in an isolated built Electron app.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect } from '@playwright/test';
import { FuseV1Options, FuseVersion, flipFuses } from '@electron/fuses';
import { createServer } from 'node:net';
import { ConnectionSettings } from '../../src/main/connection-settings.ts';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';

const appRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));

test(
  'old authorization data offers safe Alert recovery and reaches real service readiness after explicit confirmation',
  { timeout: 120000 },
  async () => {
    const data = await mkdtemp(join(tmpdir(), 'octopus-recovery-ui-'));
    const project = join(data, 'project');
    await mkdir(project);
    const binary = join(appRoot, 'dist/native/file-commit.node');
    const native = createRequire(binary)(binary);
    assert.equal((await native.createRecovery(join(project, 'tasks'))).ok, true);
    const journal = join(project, 'tasks/events.jsonl');
    const original =
      JSON.stringify({
        kind: 'grant',
        sequence: 1,
        value: {
          clientId: randomUUID(),
          scope: 'device',
          label: 'isolated old grant',
          permissions: ['files.read', 'computer.observe'],
          waitBudgetMs: 120000,
          revoked: false,
          tokenHash: 'a'.repeat(64),
        },
      }) + '\n';
    assert.equal((await native.writePrivateConfig(journal, original)).ok, true);
    let app;
    try {
      const product = process.env.EXECUTOR_RECOVERY_PRODUCT;
      if (product) {
        const clone = join(data, 'application');
        await cp(product, clone, { recursive: true });
        // Enable only the inspector in the disposable copy; leave the actual release executable untouched.
        await flipFuses(join(clone, 'Dr.Octopus Executor.exe'), {
          version: FuseVersion.V1,
          [FuseV1Options.EnableNodeCliInspectArguments]: true,
        });
        await writeFile(
          join(clone, 'resources/executor/setup/register-browser-host.ps1'),
          'param($Mode, $ResourceRoot, $ProjectRoot, [switch]$MigrateProduct)\r\nexit 0\r\n'
        );
        const server = createServer();
        await new Promise((resolve, reject) => {
          server.once('error', reject);
          server.listen(0, '127.0.0.1', resolve);
        });
        const port = server.address().port;
        await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
        const settings = await ConnectionSettings.open(new NativeFileCommit(binary), project);
        await settings.save({ port, networkAddress: null });
        app = await electron.launch({
          executablePath: join(clone, 'Dr.Octopus Executor.exe'),
          args: ['--user-data-dir=' + data],
          env: { ...process.env, PATH: join(process.env.SystemRoot, 'System32'), NODE_OPTIONS: '' },
        });
        assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
      } else {
        app = await electron.launch({
          cwd: appRoot,
          args: [appRoot, '--executor-test', '--executor-test-data=' + data],
        });
      }
      const page = await app.firstWindow();
      page.setDefaultTimeout(20000);
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await app.evaluate(({ BrowserWindow, clipboard }) => {
        BrowserWindow.getAllWindows()[0].show();
        clipboard.writeText = (value) => {
          globalThis.recoveryCopied = value;
        };
      });
      await expect
        .poll(async () => (await page.evaluate(() => window.executor.readStatus())).data?.state, {
          timeout: 30000,
        })
        .toBe('failed');
      const status = await page.evaluate(() => window.executor.readStatus());
      assert.equal(status.data.startupFailure, 'CONTROL_STORE_INVALID', JSON.stringify(status.data));
      const identity = (await page.evaluate(() => window.executor.readSettings())).data.device;
      const alert = page.getByTestId('runtime-recovery-alert');
      await expect(alert).toContainText('授权与任务数据不兼容或损坏');
      await expect(alert.getByRole('button', { name: '备份并重置', exact: true })).toBeEnabled();
      await alert.getByRole('button', { name: '查看详情' }).click();
      await expect(alert).toContainText('CONTROL_STORE_INVALID');
      await alert.getByRole('button', { name: '复制错误信息' }).click();
      const copied = await app.evaluate(() => globalThis.recoveryCopied);
      assert.match(copied, /CONTROL_STORE_INVALID/);
      assert.ok(!copied.includes('tokenHash'));
      const evidence = process.env.EXECUTOR_RECOVERY_EVIDENCE;
      if (evidence) {
        await mkdir(evidence, { recursive: true });
        await page.screenshot({ path: join(evidence, 'failure-desktop.png') });
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(720, 560));
        await page.screenshot({ path: join(evidence, 'failure-compact.png') });
        assert.ok(await alert.evaluate((element) => element.scrollWidth <= element.clientWidth));
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1040, 760));
      }
      await alert.getByRole('button', { name: '备份并重置', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '备份并重置相关数据？', exact: true });
      await expect(dialog).toContainText('设备身份及其他设置保留');
      if (evidence) {
        await page.screenshot({ path: join(evidence, 'confirmation.png') });
      }
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      assert.equal(await readFile(journal, 'utf8'), original);
      assert.equal((await page.evaluate(() => window.executor.readStatus())).data.state, 'failed');
      await assert.rejects(
        page.evaluate(() =>
          window.executor.maintenanceAction({ action: 'reset', revision: 0, path: 'C:\\' })
        ),
        /unrecognized_keys/
      );
      await alert.getByRole('button', { name: '备份并重置', exact: true }).click();
      await dialog.getByRole('button', { name: '备份并重置', exact: true }).click();
      await expect(alert).toContainText('执行服务已恢复', { timeout: 60000 });
      const restored = await page.evaluate(() => window.executor.readStatus());
      assert.equal(restored.data.state, 'ready');
      assert.equal(restored.data.startupFailure, null);
      const access = await page.evaluate(() => window.executor.readAccess());
      assert.equal(access.ok, true);
      assert.deepEqual(access.data.clients, []);
      assert.deepEqual((await page.evaluate(() => window.executor.readSettings())).data.device, identity);
      const maintenance = await page.evaluate(() => window.executor.readMaintenance());
      assert.equal(
        await readFile(join(maintenance.data.backupPath, 'data/tasks/events.jsonl'), 'utf8'),
        original
      );
      assert.equal(
        await readFile(
          join(maintenance.data.backupPath, '.octopus-executor-recovery-originals/tasks/events.jsonl'),
          'utf8'
        ),
        original
      );
      if (evidence) {
        await page.screenshot({ path: join(evidence, 'recovered.png') });
      }
      await alert.getByRole('button', { name: '前往连接' }).click();
      await expect(page.getByRole('tab', { name: '连接', exact: true })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      assert.deepEqual(errors, []);
    } finally {
      await app?.close();
      assert.ok(data.startsWith(join(tmpdir(), 'octopus-recovery-ui-')));
      await rm(data, { recursive: true, force: true });
    }
  }
);
