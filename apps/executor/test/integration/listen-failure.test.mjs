/**
 * @author Codex
 * @description Verifies real listener startup failures, copied diagnostics and settings navigation in an isolated Electron app.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir, networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { _electron as electron, expect } from '@playwright/test';
import { ConnectionSettings } from '../../src/main/connection-settings.ts';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';

const appRoot = resolve(
  process.env.EXECUTOR_LISTEN_TEST_APP || fileURLToPath(new URL('../../', import.meta.url))
);

for (const kind of ['unavailable-address', 'occupied-port']) {
  test(
    `startup ${kind} explains the setting to change and preserves copied diagnostics after retry`,
    { timeout: 90000 },
    async () => {
      const data = await mkdtemp(join(tmpdir(), 'octopus-listen-ui-'));
      const occupied = createServer();
      const errors = [];
      let app;
      try {
        await mkdir(join(data, 'project'));
        await new Promise((resolve, reject) => {
          occupied.once('error', reject);
          occupied.listen(0, '127.0.0.1', resolve);
        });
        const port = occupied.address().port;
        let address = null;
        if (kind === 'unavailable-address') {
          const assigned = Object.values(networkInterfaces())
            .flat()
            .map((item) => item.address);
          address = ['10.254.254.254', '192.168.254.254'].find((candidate) => !assigned.includes(candidate));
          assert.ok(address);
          await new Promise((resolve) => occupied.close(resolve));
        }
        const settings = await ConnectionSettings.open(
          new NativeFileCommit(join(appRoot, 'dist/native/file-commit.node')),
          join(data, 'project')
        );
        await settings.save({ port, networkAddress: address });
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        app = await electron.launch({
          cwd: appRoot,
          env,
          args: [appRoot, '--executor-test', '--executor-test-data=' + data],
        });
        const page = await app.firstWindow();
        page.setDefaultTimeout(20000);
        page.on('pageerror', (error) => errors.push(error.message));
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await app.evaluate(({ clipboard, BrowserWindow }) => {
          BrowserWindow.getAllWindows()[0].show();
          BrowserWindow.getAllWindows()[0].focus();
          clipboard.writeText = (text) => {
            globalThis.listenDiagnostics = text;
          };
        });
        await expect
          .poll(async () => (await page.evaluate(() => window.executor.readStatus())).data?.state, {
            timeout: 30000,
          })
          .toBe('failed');
        const maintenance = await page.evaluate(() => window.executor.readMaintenance());
        assert.equal(maintenance.ok, true, JSON.stringify(maintenance));
        assert.ok(maintenance.data.issue?.listenFailure, JSON.stringify(maintenance));
        const alert = page.getByTestId('runtime-recovery-alert');
        const systemCode = kind === 'unavailable-address' ? 'EADDRNOTAVAIL' : 'EADDRINUSE';
        const code = kind === 'unavailable-address' ? 'MCP_LISTEN_FAILED' : 'PORT_IN_USE';
        const endpoint = `${address || '127.0.0.1'}:${port}`;
        await expect(alert).toContainText(endpoint);
        await expect(alert).toContainText('设置 → 服务接入');
        await expect(alert).toContainText('重新启动应用');
        await expect(alert.getByRole('button', { name: '备份并重置', exact: true })).toHaveCount(0);
        await expect(alert.getByText(systemCode, { exact: true })).toBeHidden();
        await alert.getByRole('button', { name: '技术详情', exact: true }).click();
        await expect(alert.getByText(systemCode, { exact: true })).toBeVisible();
        await expect(alert.getByText(code, { exact: true })).toBeVisible();
        const evidence = process.env.EXECUTOR_LISTEN_EVIDENCE;
        if (evidence) {
          await mkdir(evidence, { recursive: true });
          await page.screenshot({ path: join(evidence, kind + '-desktop.png') });
          await app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].setContentSize(640, 600)
          );
          await page.screenshot({ path: join(evidence, kind + '-compact.png') });
          assert.ok(await alert.evaluate((element) => element.scrollWidth <= element.clientWidth));
        }
        await alert.getByRole('button', { name: '复制错误信息', exact: true }).click();
        const copied = JSON.parse(await app.evaluate(() => globalThis.listenDiagnostics));
        assert.equal(copied.issue.code, code);
        assert.equal(copied.issue.listenFailure.systemCode, systemCode);
        assert.equal(copied.issue.listenFailure.port, port);
        assert.match(copied.issue.guidance, /重新启动应用/);
        const beforeRetry = (await page.evaluate(() => window.executor.readStatus())).data.revision;
        await alert.getByRole('button', { name: '重试启动', exact: true }).click();
        await expect
          .poll(
            async () => {
              const state = (await page.evaluate(() => window.executor.readMaintenance())).data;
              return state.phase === 'failed' && state.issue?.revision > beforeRetry;
            },
            { timeout: 30000 }
          )
          .toBe(true);
        await expect(alert.getByRole('button', { name: '重试启动', exact: true })).toBeEnabled();
        await expect(alert).toContainText(endpoint);
        await expect(alert.getByText(systemCode, { exact: true })).toBeVisible();
        await alert.getByRole('button', { name: '前往网络配置', exact: true }).click();
        await expect(page.getByRole('tab', { name: '设置', exact: true })).toHaveAttribute(
          'aria-selected',
          'true'
        );
        await expect(page.getByRole('heading', { name: '服务接入', exact: true })).toBeFocused();
        await expect(page.getByLabel('MCP 服务端口', { exact: true })).toHaveValue(String(port));
        if (address) {
          await expect(page.getByLabel('本机内网 / VPN IPv4 地址', { exact: true })).toContainText(address);
        }
        assert.deepEqual(errors, []);
      } finally {
        await app?.close();
        if (occupied.listening) {
          await new Promise((resolve) => occupied.close(resolve));
        }
        assert.ok(data.startsWith(join(tmpdir(), 'octopus-listen-ui-')));
        await rm(data, { recursive: true, force: true });
      }
    }
  );
}
