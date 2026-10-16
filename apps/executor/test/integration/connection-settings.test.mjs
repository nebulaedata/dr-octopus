/**
 * @author Codex
 * @description Verifies production port changes take effect only after restart and collisions never cause fallback.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { _electron as electron, expect } from '@playwright/test';

const appRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));

/**
 * Launches the built application against only the owned temporary data root.
 */
async function launch(root, state = '已启动') {
  const app = await electron.launch({
    cwd: appRoot,
    args: [appRoot, '--executor-test', '--executor-test-data=' + root],
  });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByTestId('runtime-state').filter({ hasText: state }).waitFor();
    return { app, page };
  } catch (error) {
    await app.close().catch(() => {});
    throw error;
  }
}

/**
 * Confirms termination of a captured owned process under a finite cleanup deadline.
 */
async function assertExited(pid) {
  assert.ok(Number.isInteger(pid) && pid > 0);
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
  assert.fail('Owned process remains alive: ' + pid);
}

test(
  'tray is the default, taskbar remains available, and saved exit closes both the window and service',
  { timeout: 60000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'octopus-close-integration-'));
    let current;
    try {
      current = await launch(root);
      await current.page.getByRole('tab', { name: '设置', exact: true }).click();
      assert.equal(
        (await current.page.evaluate(() => window.executor.readSettings())).data.closeBehavior,
        'tray'
      );
      const pid = (await current.page.evaluate(() => window.executor.readStatus())).data.pid;
      await current.app.evaluate(async ({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        const hidden = new Promise((accept) => window.once('hide', accept));
        window.close();
        await hidden;
        window.show();
      });
      assert.equal((await current.page.evaluate(() => window.executor.readStatus())).data.pid, pid);
      const endpoint = (await current.page.evaluate(() => window.executor.readAccess())).data.endpoint;
      await current.page.getByLabel('MCP 服务端口').fill(new URL(endpoint).port);
      await current.page.getByRole('combobox', { name: '关闭窗口时' }).click();
      await current.page.getByRole('option', { name: '最小化到任务栏', exact: true }).click();
      await current.page.getByRole('button', { name: '保存设置', exact: true }).click();
      await current.page.locator('[data-slot="toast"]').filter({ hasText: '设置已保存。' }).waitFor();
      await current.app.evaluate(async ({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        const minimized = new Promise((accept) => window.once('minimize', accept));
        window.close();
        await minimized;
        window.restore();
      });
      assert.equal((await current.page.evaluate(() => window.executor.readStatus())).data.pid, pid);
      await current.page.getByRole('combobox', { name: '关闭窗口时' }).click();
      await current.page.getByRole('option', { name: '关闭窗口和服务', exact: true }).click();
      await current.page.getByText('关闭窗口并退出执行器，后台服务也会停止。', { exact: true }).waitFor();
      await current.page.getByRole('button', { name: '保存设置', exact: true }).click();
      await current.page.locator('[data-slot="toast"]').filter({ hasText: '设置已保存。' }).waitFor();
      await expect
        .poll(
          async () => (await current.page.evaluate(() => window.executor.readSettings())).data.closeBehavior
        )
        .toBe('exit');
      assert.equal(
        (await current.page.evaluate(() => window.executor.readSettings())).data.closeBehavior,
        'exit'
      );
      for (let attempt = 0; attempt < 2; attempt++) {
        const ownedRuntime = (await current.page.evaluate(() => window.executor.readStatus())).data.pid;
        const child = current.app.process();
        const exited = new Promise((accept) => child.once('exit', accept));
        const closed = current.app.waitForEvent('close');
        await current.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
        await closed;
        assert.equal(await exited, 0);
        await assertExited(ownedRuntime);
        await assertExited(child.pid);
        current = null;
        if (attempt === 0) {
          current = await launch(root);
          await current.page.getByRole('tab', { name: '设置', exact: true }).click();
          assert.equal(
            (await current.page.evaluate(() => window.executor.readSettings())).data.closeBehavior,
            'exit'
          );
          assert.match(
            await current.page.getByRole('combobox', { name: '关闭窗口时' }).innerText(),
            /关闭窗口和服务/
          );
        }
      }
    } finally {
      await current?.app.close().catch(() => {});
      assert.ok(root.startsWith(join(tmpdir(), 'octopus-close-integration-')));
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
);

test(
  'saved port leaves the live endpoint intact, survives restart, and reports occupied-port failure',
  { timeout: 60000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'octopus-port-integration-'));
    const occupied = createServer();
    await new Promise((resolve) => occupied.listen(0, '127.0.0.1', resolve));
    const port = occupied.address().port;
    let current;
    try {
      current = await launch(root);
      await current.page.getByRole('tab', { name: '设置', exact: true }).click();
      await current.page.getByRole('combobox', { name: '关闭窗口时' }).click();
      await current.page.getByRole('option', { name: '最小化到系统托盘', exact: true }).click();
      const live = (await current.page.evaluate(() => window.executor.readAccess())).data.endpoint;
      await current.page.context().setOffline(true);
      await current.page.getByLabel('MCP 服务端口').fill(String(port));
      await current.page.getByRole('button', { name: '保存设置', exact: true }).click();
      await current.page.getByText('已保存的设置待重启生效', { exact: true }).waitFor();
      // Verify the restart notice independently of the dismissible toast, whose timer pauses on hover/focus.
      const savedToast = current.page.locator('[data-slot="toast"]').filter({ hasText: '设置已保存。' });
      await savedToast.getByRole('button', { name: 'Close toast', exact: true }).click();
      await expect(
        current.page.locator('[data-slot="toast"]').filter({ hasText: '设置已保存。' })
      ).toHaveCount(0);
      await current.page.getByText('已保存的设置待重启生效', { exact: true }).waitFor();
      assert.equal(await current.page.getByText('有未保存的更改', { exact: true }).count(), 0);
      assert.equal((await current.page.evaluate(() => window.executor.readAccess())).data.endpoint, live);
      assert.equal(
        (await current.page.evaluate(() => window.executor.readSettings())).data.pendingRestart,
        true
      );
      await current.app.close();
      current = null;
      current = await launch(root, '异常');
      assert.equal(
        (await current.page.evaluate(() => window.executor.readStatus())).data.capabilities.basic.available,
        false
      );
      assert.equal((await current.page.evaluate(() => window.executor.readSettings())).data.port, port);
      await current.app.close();
      current = null;
      await new Promise((resolve) => occupied.close(resolve));
      current = await launch(root);
      assert.equal(
        (await current.page.evaluate(() => window.executor.readAccess())).data.endpoint,
        `http://127.0.0.1:${port}/mcp`
      );
      assert.equal(
        (await current.page.evaluate(() => window.executor.readSettings())).data.pendingRestart,
        false
      );
      assert.equal(
        (await current.page.evaluate(() => window.executor.readSettings())).data.closeBehavior,
        'tray'
      );
      const pid = (await current.page.evaluate(() => window.executor.readStatus())).data.pid;
      await current.app.evaluate(async ({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.show();
        const hidden = new Promise((resolve) => window.once('hide', resolve));
        window.close();
        await hidden;
      });
      assert.equal(
        await current.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
        false
      );
      assert.equal((await current.page.evaluate(() => window.executor.readStatus())).data.pid, pid);
      await current.app.evaluate(({ app }) => app.emit('activate'));
      assert.equal(
        await current.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
        true
      );
    } finally {
      await current?.app.close().catch(() => {});
      if (occupied.listening) {
        await new Promise((resolve) => occupied.close(resolve));
      }
      assert.ok(root.startsWith(join(tmpdir(), 'octopus-port-integration-')));
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
);
