/**
 * @author Codex
 * @description Verifies connection guide clipboard boundaries and compact permissions in the real Electron UI.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { _electron as electron, expect } from '@playwright/test';

const appRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));

test(
  'client setup keeps credentials in Main and permission summaries on one line',
  { timeout: 60000 },
  async () => {
    const data = await mkdtemp(join(tmpdir(), 'octopus-client-setup-'));
    const electronEnvironment = { ...process.env };
    delete electronEnvironment.ELECTRON_RUN_AS_NODE;
    let app;
    try {
      app = await electron.launch({
        cwd: appRoot,
        args: [appRoot, '--executor-test', '--executor-test-data=' + data],
        env: electronEnvironment,
      });
      const page = await app.firstWindow();
      page.setDefaultTimeout(15000);
      const managementWindow = await app.browserWindow(page);
      /**
       * Main intentionally hides test windows; interactive checks require visible foreground rendering.
       */
      await managementWindow.evaluate((window) => {
        window.show();
        window.focus();
      });
      await page.bringToFront();
      await expect
        .poll(() => managementWindow.evaluate((window) => window.isVisible() && window.isFocused()))
        .toBe(true);
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error' || message.type() === 'warning') {
          errors.push(message.type() + ': ' + message.text());
        }
      });
      await page.getByTestId('runtime-state').filter({ hasText: '已启动' }).waitFor();
      await app.evaluate(({ BrowserWindow, clipboard }) => {
        BrowserWindow.getAllWindows()[0].setSize(820, 850);
        clipboard.writeText = (text) => {
          globalThis.setupClipboard = text;
        };
      });
      const evidence =
        process.env.EXECUTOR_LAYOUT_CAPTURE ??
        join(
          appRoot,
          'build/validation-evidence/tool-overview',
          new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid
        );
      await mkdir(evidence, { recursive: true });
      const access = await page.evaluate(() => window.executor.readAccess());
      assert.equal(access.ok, true);
      const catalog = access.data.toolCatalog;
      assert.ok(catalog.basic.includes('powershell'));
      assert.ok(!catalog.basic.includes('bash'));
      const toolSection = page.getByRole('region', { name: '工具与桥接' });
      await expect(toolSection.getByRole('button', { name: '查看基础工具', exact: true })).toContainText(
        '已就绪'
      );
      await expect(toolSection).not.toContainText('清单读取中');
      const toolText = await toolSection.innerText();
      for (const name of Object.values(catalog).flat()) {
        assert.equal(toolText.includes(name), false, name + ' should be in details only');
      }
      assert.equal(await toolSection.getByRole('button').count(), 5);
      for (const [title, keys] of [
        ['基础工具', ['basic']],
        ['文件传输', ['transfer']],
        ['任务管理', ['control']],
        ['桌面控制工具', ['computer']],
      ]) {
        const trigger = toolSection.getByRole('button', { name: '查看' + title, exact: true });
        await trigger.click();
        const dialog = page.getByRole('dialog', { name: title, exact: true });
        await expect(dialog).toBeVisible();
        const names = keys.flatMap((key) => catalog[key]);
        for (const name of names) {
          await expect(dialog.getByText(name, { exact: true })).toBeVisible();
        }
        assert.equal(await dialog.getByRole('listitem').count(), names.length);
        if (title === '文件传输') {
          await expect(dialog.getByRole('button', { name: '使用说明', exact: true })).toHaveAttribute(
            'aria-expanded',
            'false'
          );
          await dialog.screenshot({ path: join(evidence, 'tool-dialog-transfer.png') });
        }
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(trigger).toBeFocused();
      }
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1040, 760));
      await toolSection.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(evidence, 'tool-overview-dialogs.png') });
      await toolSection.getByRole('button', { name: '查看浏览器桥接', exact: true }).click();
      await page
        .getByRole('dialog', { name: '浏览器桥接', exact: true })
        .getByRole('button', { name: '管理浏览器桥接', exact: true })
        .click();
      await expect(page.getByRole('region', { name: '浏览器桥接设置' })).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.getByText('浏览器工具 · ' + catalog.browser.length + ' 项', { exact: true }).click();
      for (const name of catalog.browser) {
        await expect(
          page.getByRole('region', { name: '浏览器桥接设置' }).getByText(name, { exact: true })
        ).toBeVisible();
      }
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(820, 850));
      const approval = await page.evaluate(() =>
        window.executor.approveAccess({
          label: '办公室智能体',
          permissions: ['files.read', 'files.write', 'shell.execute'],
          waitBudgetMs: 120000,
        })
      );
      assert.equal(approval.ok, true);
      const clientId = approval.data.clients.at(-1).clientId;
      await page.getByRole('tab', { name: '连接', exact: true }).click();
      const summary = page.locator('p[title="读取与搜索文件 · 写入与编辑文件 · 运行 PowerShell 命令"]');
      await expect(summary).toBeVisible();
      assert.ok((await page.locator('p[title="办公室智能体"]').boundingBox()).width <= 160);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(720, 850));
      await expect
        .poll(() => summary.evaluate((element) => element.scrollWidth > element.clientWidth))
        .toBe(true);
      const layout = await summary.evaluate((element) => ({
        overflow: getComputedStyle(element).textOverflow,
        wrap: getComputedStyle(element).whiteSpace,
        clipped: element.scrollWidth > element.clientWidth,
      }));
      assert.deepEqual(layout, { overflow: 'ellipsis', wrap: 'nowrap', clipped: true });
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(820, 850));
      const tabs = await page.getByRole('tablist', { name: '执行器页面' }).boundingBox();
      assert.ok(tabs.y >= 20, 'tabs have comfortable top spacing');
      await page.getByRole('button', { name: '配置客户端', exact: true }).click();
      await page.getByRole('button', { name: '复制给智能体', exact: true }).click();
      await page.locator('[data-slot="toast"]').filter({ hasText: '连接文档已复制' }).waitFor();
      const guide = await app.evaluate(() => globalThis.setupClipboard);
      const blocks = [...guide.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => JSON.parse(match[1]));
      assert.equal(blocks[0].deviceId, approval.data.device.deviceId);
      const token = Object.values(blocks[1].mcpServers)[0].headers.Authorization.slice(7);
      assert.match(token, /^[a-f0-9]{64}$/);
      assert.equal((await page.locator('body').innerText()).includes(token), false);
      const preview = await page.evaluate(
        (clientId) => window.executor.readClientConfiguration({ clientId, transport: 'http' }),
        clientId
      );
      assert.equal(JSON.stringify(preview).includes(token), false);
      await page.screenshot({ path: join(appRoot, 'build', 'client-setup.png') });
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.setMinimumSize(320, 560);
        window.setContentSize(560, 850);
      });
      assert.equal(await page.evaluate(() => innerWidth), 560);
      await page.getByRole('tab', { name: '状态', exact: true }).click();
      await page.getByRole('button', { name: '查看文件传输', exact: true }).click();
      const narrowDialog = page.getByRole('dialog', { name: '文件传输', exact: true });
      await expect(narrowDialog).toBeVisible();
      assert.equal(await narrowDialog.evaluate((node) => node.scrollWidth > node.clientWidth), false);
      await narrowDialog.screenshot({ path: join(appRoot, 'build', 'tool-dialog-narrow.png') });
      await narrowDialog.getByRole('button', { name: '关闭', exact: true }).click();
      await expect(narrowDialog).toHaveCount(0);
      await page.getByRole('tab', { name: '连接', exact: true }).click();
      await page.getByRole('button', { name: '配置客户端', exact: true }).click();

      await expect(page.getByRole('button', { name: '复制给智能体', exact: true })).toBeVisible();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: join(appRoot, 'build', 'client-setup-narrow.png') });
      await app.evaluate(({ clipboard }) => {
        clipboard.writeText = () => {
          throw new Error('fixture clipboard unavailable');
        };
      });
      const failed = await page.evaluate(
        (clientId) => window.executor.copyAgentGuide({ clientId, transport: 'http' }),
        clientId
      );
      assert.equal(failed.ok, false);
      assert.equal(JSON.stringify(failed).includes(token), false);
      const revoked = await page.evaluate((clientId) => window.executor.revokeAccess({ clientId }), clientId);
      assert.equal(revoked.ok, true);
      const denied = await page.evaluate(
        (clientId) => window.executor.copyAgentGuide({ clientId, transport: 'http' }),
        clientId
      );
      assert.equal(denied.ok, false);
      assert.equal(await app.evaluate(() => globalThis.setupClipboard), guide);
      assert.deepEqual(errors, []);
    } finally {
      await app?.close();
      await rm(data, { recursive: true, force: true });
    }
  }
);
