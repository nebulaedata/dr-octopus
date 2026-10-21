/**
 * @author Codex
 * @description Exercises local address discovery, explicit selection, stale settings and refresh recovery through real Electron IPC.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { networkInterfaces, tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect } from '@playwright/test';
import { ConnectionSettings } from '../../src/main/connection-settings.ts';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';

const appRoot = resolve(
  process.env.EXECUTOR_NETWORK_TEST_APP || fileURLToPath(new URL('../../', import.meta.url))
);

test(
  'network address selection preserves stale choices, refreshes safely and revalidates before saving',
  { timeout: 90000 },
  async () => {
    const data = await mkdtemp(join(tmpdir(), 'octopus-network-choice-'));
    let app;
    try {
      await mkdir(join(data, 'project'));
      const assigned = Object.values(networkInterfaces())
        .flat()
        .map((item) => item.address);
      const stale = ['10.254.254.254', '192.168.254.254'].find((value) => !assigned.includes(value));
      assert.ok(stale);
      const listener = createServer();
      await new Promise((resolve, reject) => {
        listener.once('error', reject);
        listener.listen(0, '127.0.0.1', resolve);
      });
      const port = listener.address().port;
      await new Promise((resolve) => listener.close(resolve));
      const settings = await ConnectionSettings.open(
        new NativeFileCommit(join(appRoot, 'dist/native/file-commit.node')),
        join(data, 'project')
      );
      await settings.save({ port, networkAddress: stale });
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      app = await electron.launch({
        cwd: appRoot,
        args: [appRoot, '--executor-test', '--executor-test-data=' + data],
        env,
      });
      const page = await app.firstWindow();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].show();
        BrowserWindow.getAllWindows()[0].focus();
      });
      const choices = await page.evaluate(() => window.executor.readNetworkAddresses());
      assert.equal(choices.ok, true);
      assert.ok(
        choices.data.length > 0,
        'At least one assigned private IPv4 is required for the real save flow.'
      );
      const selected = choices.data[0];
      await page.getByRole('tab', { name: '设置', exact: true }).click();
      const address = page.getByRole('combobox', { name: '本机内网 / VPN IPv4 地址', exact: true });
      const refresh = page.getByRole('button', { name: '刷新本机网络地址', exact: true });
      const save = page.getByRole('button', { name: '保存设置', exact: true });
      await expect(address).toContainText(stale);
      await expect(address).toContainText('当前不可用');
      await expect(
        page.getByText(`地址 ${stale} 当前不在本机。请重新选择，或关闭内网访问。`, { exact: true })
      ).toBeVisible();
      await expect(save).toBeDisabled();
      await address.click();
      const option = page.getByRole('option', {
        name: `${selected.interfaceName} · ${selected.address}`,
        exact: true,
      });
      await expect(option).toBeVisible();
      const evidence = process.env.EXECUTOR_NETWORK_EVIDENCE;
      if (evidence) {
        await mkdir(evidence, { recursive: true });
        await page.screenshot({ path: join(evidence, 'address-options.png') });
      }
      await option.click();
      assert.equal((await page.evaluate(() => window.executor.readSettings())).data.networkAddress, stale);
      await expect(save).toBeEnabled();
      await save.click();
      await expect
        .poll(async () => (await page.evaluate(() => window.executor.readSettings())).data.networkAddress)
        .toBe(selected.address);
      await expect(page.getByText('已保存的设置待重启生效', { exact: true })).toBeVisible();

      /**
       * Simulates OS-list responses only in the disposable app while retaining production Preload validation, Query and save-time OS discovery.
       */
      async function refreshWith(reply) {
        await app.evaluate(({ ipcMain }, reply) => {
          globalThis.networkReads = 0;
          ipcMain.removeHandler('executor:connection-settings:network-addresses');
          ipcMain.handle('executor:connection-settings:network-addresses', () => {
            globalThis.networkReads += 1;
            return reply;
          });
        }, reply);
        await refresh.click();
        await expect.poll(() => app.evaluate(() => globalThis.networkReads)).toBeGreaterThan(0);
      }
      // A newly reported option must still be refused if it is absent from the actual OS snapshot at save time.
      await refreshWith({
        ok: true,
        data: [...choices.data, { address: stale, interfaceName: 'VPN fixture' }],
      });
      await expect(address).toContainText(selected.address);
      await address.click();
      await page.getByRole('option', { name: `VPN fixture · ${stale}`, exact: true }).click();
      await save.click();
      await expect(
        page.getByText('所选内网地址当前不在本机，请刷新地址列表后重新选择，或关闭内网访问', { exact: true })
      ).toBeVisible();
      assert.equal(
        (await page.evaluate(() => window.executor.readSettings())).data.networkAddress,
        selected.address
      );
      await address.click();
      await page
        .getByRole('option', { name: `${selected.interfaceName} · ${selected.address}`, exact: true })
        .click();

      await refreshWith({ ok: true, data: [{ address: stale, interfaceName: 'VPN fixture' }] });
      await expect(address).toContainText(selected.address);
      await expect(address).toContainText('当前不可用');
      await expect(save).toBeDisabled();
      assert.equal(
        (await page.evaluate(() => window.executor.readSettings())).data.networkAddress,
        selected.address
      );
      if (evidence) {
        await app.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0];
          window.setMinimumSize(320, 560);
          window.setContentSize(560, 850);
        });
        await address.scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(evidence, 'stale-address-narrow.png') });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      }
      await refreshWith({ ok: true, data: [] });
      await expect(
        page.getByText('未检测到可用的内网 / VPN IPv4 地址。请连接网络或 VPN 后刷新，或关闭内网访问。', {
          exact: true,
        })
      ).toBeVisible();
      await expect(address).toContainText(selected.address);
      await refreshWith({ ok: false, code: 'UNAVAILABLE', message: 'fixture network unavailable' });
      await expect(
        page.getByText('无法读取本机网络地址，请刷新重试；也可关闭内网访问，仅在本机使用。', { exact: true })
      ).toBeVisible();
      await expect(save).toBeDisabled();
      await expect(refresh).toBeEnabled();
      await refreshWith({ ok: true, data: [selected] });
      await expect(address).toBeEnabled();
      await expect(address).toContainText(selected.address);
      await expect(page.locator('#network-address-error')).toHaveCount(0);
      await page.getByRole('switch', { name: '允许内网 / VPN 客户端连接', exact: true }).click();
      await save.click();
      await expect
        .poll(async () => (await page.evaluate(() => window.executor.readSettings())).data.networkAddress)
        .toBe(null);
      await page.getByRole('switch', { name: '允许内网 / VPN 客户端连接', exact: true }).click();
      await expect(address).toContainText('选择本机网卡地址');
      await expect(save).toBeDisabled();
      assert.equal((await page.evaluate(() => window.executor.readSettings())).data.networkAddress, null);
      assert.deepEqual(errors, []);
    } finally {
      await app?.close();
      assert.ok(data.startsWith(join(tmpdir(), 'octopus-network-choice-')));
      await rm(data, { recursive: true, force: true });
    }
  }
);
