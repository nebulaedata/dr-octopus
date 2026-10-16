/**
 * @author Codex
 * @description Verifies the built settings UI and active device identity across a complete restart.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { _electron as electron, expect } from '@playwright/test';

const appRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));

/**
 * Starts only the built test app with isolated user data and captures renderer failures.
 */
async function launch(root) {
  const app = await electron.launch({
    cwd: appRoot,
    args: [appRoot, '--executor-test', '--executor-test-data=' + root],
  });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    await page.emulateMedia({ colorScheme: null });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByTestId('runtime-state').filter({ hasText: '已启动' }).waitFor();
    await page.getByRole('tab', { name: '设置', exact: true }).click();
    return { app, page, errors };
  } catch (error) {
    await app.close();
    throw error;
  }
}

test(
  'device settings show active identity and commit rename only after complete restart',
  { timeout: 90000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'octopus-device-ui-'));
    let current;
    try {
      current = await launch(root);
      const original = await current.page.evaluate(() => window.executor.readSettings());
      assert.equal(original.ok, true);
      await expect(
        current.page.getByText('设备 ID：' + original.data.device.deviceId, { exact: true })
      ).toBeVisible();
      await current.page.getByLabel('设备名称', { exact: true }).fill('张的办公电脑');
      await current.page.getByRole('button', { name: '保存设置', exact: true }).click();
      await expect(current.page.getByText('待重启生效名称：张的办公电脑', { exact: true })).toBeVisible();
      const pending = await current.page.evaluate(() => window.executor.readSettings());
      assert.equal(pending.data.pendingRestart, true);
      assert.deepEqual(pending.data.device, original.data.device);
      const access = await current.page.evaluate(() => window.executor.readAccess());
      assert.deepEqual(access.data.device, original.data.device);
      await current.page.getByLabel('设备名称', { exact: true }).fill('');
      await expect(current.page.getByRole('button', { name: '保存设置', exact: true })).toBeDisabled();
      assert.deepEqual(current.errors, []);
      await current.app.close();
      current = await launch(root);
      const saved = await current.page.evaluate(() => window.executor.readSettings());
      assert.equal(saved.data.device.deviceId, original.data.device.deviceId);
      assert.equal(saved.data.device.deviceName, '张的办公电脑');
      assert.equal(saved.data.pendingRestart, false);
      for (const themeSource of ['light', 'dark']) {
        await current.page.evaluate(
          (themeSource) => window.executor.saveSettings({ port: 19876, networkAddress: null, themeSource }),
          themeSource
        );
        await current.page.reload();
        await current.page.getByRole('tab', { name: '设置', exact: true }).click();
        await expect
          .poll(() => current.page.evaluate(() => document.documentElement.classList.contains('dark')))
          .toBe(themeSource === 'dark');
        await current.page.getByLabel('设备名称', { exact: true }).scrollIntoViewIfNeeded();
        await current.page.screenshot({
          path: join(appRoot, 'build', `device-identity-${themeSource}.png`),
          fullPage: true,
        });
      }
      await current.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(560, 850));
      await expect(current.page.getByLabel('设备名称', { exact: true })).toBeVisible();
      await current.page.screenshot({
        path: join(appRoot, 'build', 'device-identity-narrow.png'),
        fullPage: true,
      });
      assert.deepEqual(current.errors, []);
    } finally {
      await current?.app.close();
      await rm(root, { recursive: true, force: true });
    }
  }
);
