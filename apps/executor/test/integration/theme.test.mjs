/**
 * @author Codex
 * @description Verifies live effective theme changes, native surface synchronization and saved theme restoration.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'node:net';
import { ConnectionSettings } from '../../src/main/connection-settings.ts';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';
import { _electron as electron, expect } from '@playwright/test';

const appRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));

/**
 * Opens only a built test instance with isolated settings and observes native caption updates.
 */
async function launch(data) {
  const app = await electron.launch({
    cwd: appRoot,
    args: [appRoot, '--executor-test', '--executor-test-data=' + data],
  });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    // Remove Playwright's default light emulation so Chromium observes Electron's effective theme.
    await page.emulateMedia({ colorScheme: null, reducedMotion: 'reduce' });
    await page.getByTestId('runtime-state').filter({ hasText: '已启动' }).waitFor();
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.show();
      const original = window.setTitleBarOverlay.bind(window);
      window.setTitleBarOverlay = (colors) => {
        globalThis.themeCaption = colors;
        original(colors);
      };
    });
    return { app, page };
  } catch (error) {
    await app.close();
    throw error;
  }
}

/**
 * Checks page tokens, browser controls and native surfaces after asynchronous theme propagation.
 */
async function assertTheme(current, dark, captionUpdated = true) {
  const color = dark ? '#0a0a0a' : '#ffffff';
  await expect
    .poll(() => current.page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(dark);
  await expect
    .poll(() =>
      current.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].getBackgroundColor().toLowerCase()
      )
    )
    .toBe(color);
  assert.equal(
    await current.page.evaluate(() => getComputedStyle(document.documentElement).colorScheme),
    dark ? 'dark' : 'light'
  );
  assert.equal(
    await current.page.locator('body').evaluate((node) => getComputedStyle(node).backgroundColor),
    dark ? 'oklch(0.145 0 0)' : 'oklch(1 0 0)'
  );
  assert.equal(
    await current.page.locator('header').evaluate((node) => getComputedStyle(node).backgroundColor),
    dark ? 'oklch(0.145 0 0)' : 'oklch(1 0 0)'
  );
  if (captionUpdated) {
    await expect
      .poll(() => current.app.evaluate(() => globalThis.themeCaption))
      .toEqual({ color, symbolColor: dark ? '#fafafa' : '#0a0a0a' });
  }
}

test(
  'themes switch live, preserve runtime and restore saved preferences before the next window opens',
  { timeout: 90000 },
  async () => {
    const data = await mkdtemp(join(tmpdir(), 'octopus-theme-'));
    let current;
    try {
      // Seed a real listener setting: test-mode's unsaved port 0 intentionally differs from the UI default.
      const server = createServer();
      await new Promise((accept, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', accept);
      });
      const port = server.address().port;
      await new Promise((accept, reject) => server.close((error) => (error ? reject(error) : accept())));
      const native = new NativeFileCommit(join(appRoot, 'dist/native/file-commit.node'));
      const settings = await ConnectionSettings.open(native, join(data, 'project'));
      await settings.save({ port, networkAddress: null, closeBehavior: 'tray', themeSource: 'system' });
      current = await launch(data);
      assert.equal(await current.app.evaluate(({ nativeTheme }) => nativeTheme.themeSource), 'system');
      assert.equal(
        (await current.page.evaluate(() => window.executor.readSettings())).data.themeSource,
        'system'
      );
      const pid = (await current.page.evaluate(() => window.executor.readStatus())).data.pid;
      // Electron overrides deterministically exercise the same updated event and Chromium media change as OS changes.
      const initialDark = await current.app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors);
      const transitions = initialDark ? ['light', 'dark', 'light', 'dark'] : ['dark', 'light', 'dark'];
      for (const source of transitions) {
        await current.app.evaluate(({ nativeTheme }, value) => {
          nativeTheme.themeSource = value;
        }, source);
        await assertTheme(current, source === 'dark');
      }
      await current.page.getByRole('tab', { name: '设置', exact: true }).click();
      const before = await current.page.evaluate(() => window.executor.readSettings());
      await current.page.getByLabel('MCP 服务端口').fill(String(before.data.port));
      for (const [label, source] of [
        ['明亮', 'light'],
        ['暗黑', 'dark'],
      ]) {
        await current.page.getByRole('combobox', { name: '界面主题' }).click();
        await current.page.getByRole('option', { name: label, exact: true }).click();
        await current.page.getByRole('button', { name: '保存设置', exact: true }).click();
        await expect
          .poll(
            async () => (await current.page.evaluate(() => window.executor.readSettings())).data.themeSource
          )
          .toBe(source);
        await assertTheme(current, source === 'dark');
        assert.equal(
          (await current.page.evaluate(() => window.executor.readSettings())).data.pendingRestart,
          false
        );
        assert.equal((await current.page.evaluate(() => window.executor.readStatus())).data.pid, pid);
        await mkdir(join(appRoot, '../../.playwright-executor-theme'), { recursive: true });
        await current.page.screenshot({
          path: join(appRoot, '../../.playwright-executor-theme', source + '.png'),
        });
      }
      const invalid = await current.app.evaluate(async ({ ipcMain, BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        const handler = ipcMain._invokeHandlers.get('executor:connection-settings:save');
        return handler(
          { sender: window.webContents, senderFrame: window.webContents.mainFrame },
          { port: 19876, networkAddress: null, themeSource: 'invalid' }
        );
      });
      assert.equal(invalid.ok, false);
      assert.equal(invalid.code, 'INVALID_REQUEST');
      await current.app.close();
      current = await launch(data);
      assert.equal(await current.app.evaluate(({ nativeTheme }) => nativeTheme.themeSource), 'dark');
      await assertTheme(current, true, false);
      await current.page.getByRole('tab', { name: '设置', exact: true }).click();
      await expect(current.page.getByRole('combobox', { name: '界面主题' })).toContainText('暗黑');
      await current.page.getByRole('combobox', { name: '界面主题' }).click();
      await current.page.getByRole('option', { name: '跟随系统', exact: true }).click();
      await current.page.getByRole('button', { name: '保存设置', exact: true }).click();
      await expect
        .poll(() => current.app.evaluate(({ nativeTheme }) => nativeTheme.themeSource))
        .toBe('system');
      const systemDark = await current.app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors);
      await assertTheme(current, systemDark, !systemDark);
      await current.app.close();
      current = await launch(data);
      assert.equal(await current.app.evaluate(({ nativeTheme }) => nativeTheme.themeSource), 'system');
      await assertTheme(
        current,
        await current.app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors),
        false
      );
    } finally {
      await current?.app.close().catch(() => {});
      assert.ok(data.startsWith(join(tmpdir(), 'octopus-theme-')));
      await rm(data, { recursive: true, force: true });
    }
  }
);
