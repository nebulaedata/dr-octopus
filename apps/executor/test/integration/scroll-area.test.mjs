/**
 * @author Codex
 * @description Verifies default pages fit the desktop viewport and a resized window scrolls content without moving navigation.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { _electron as electron, expect } from '@playwright/test';

const appRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));

test(
  'default pages fit without scrollbars and a shorter window scrolls through ScrollArea',
  { timeout: 45000 },
  async () => {
    const data = await mkdtemp(join(tmpdir(), 'octopus-scroll-area-'));
    const app = await electron.launch({
      cwd: appRoot,
      args: [
        appRoot,
        '--executor-test',
        '--executor-test-data=' + data,
        ...(process.env.EXECUTOR_DEV_QA === '1' ? ['--executor-dev'] : []),
      ],
    });
    try {
      const page = await app.firstWindow();
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.getByTestId('runtime-state').filter({ hasText: '已启动' }).waitFor();
      await page.getByRole('status').filter({ hasText: '尚无客户端会话' }).waitFor();
      const viewport = page.locator('main [data-slot="scroll-area-viewport"]');
      const scrollbar = page.locator('main [data-slot="scroll-area-scrollbar"]');
      assert.equal(await viewport.evaluate((node) => getComputedStyle(node).scrollbarWidth), 'none');
      for (const name of ['状态', '连接', '设置']) {
        await page.getByRole('tab', { name, exact: true }).click();
        await expect
          .poll(() => viewport.evaluate((node) => node.scrollHeight - node.clientHeight))
          .toBeLessThanOrEqual(1);
        await expect(scrollbar).toHaveCount(0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), true);
      }
      await page.getByRole('tab', { name: '状态', exact: true }).click();
      const navigation = await page.getByRole('tablist', { name: '执行器页面' }).boundingBox();
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1040, 560));
      await expect
        .poll(() => viewport.evaluate((node) => node.scrollHeight - node.clientHeight))
        .toBeGreaterThan(1);
      await expect(scrollbar).toBeVisible();
      await viewport.hover();
      await page.mouse.wheel(0, 800);
      await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
      await expect(page.getByRole('button', { name: '管理授权', exact: true })).toBeInViewport();
      await viewport.focus();
      await page.keyboard.press('Home');
      await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBe(0);
      await page.keyboard.press('End');
      await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
      assert.deepEqual(await page.getByRole('tablist', { name: '执行器页面' }).boundingBox(), navigation);
      assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), true);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1040, 760));
      await expect(scrollbar).toHaveCount(0);
      await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBe(0);
      assert.deepEqual(errors, []);
    } finally {
      await app.close();
      assert.ok(data.startsWith(join(tmpdir(), 'octopus-scroll-area-')));
      await rm(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
);
