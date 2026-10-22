/**
 * @author Codex
 * @description Verifies real three-page navigation, compact native-overlay layout, independent grant creation and optional client setup.
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
  'three-page desktop keeps native controls, collapsed guidance and grant creation independent of client setup',
  { timeout: 60000 },
  async () => {
    const data = await mkdtemp(join(tmpdir(), 'octopus-overview-'));
    const app = await electron.launch({
      cwd: appRoot,
      args: [appRoot, '--executor-test', '--executor-test-data=' + data],
    });
    try {
      const page = await app.firstWindow();
      page.setDefaultTimeout(15000);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.getByTestId('runtime-state').filter({ hasText: '已启动' }).waitFor();
      await expect(page.getByRole('region', { name: '客户端会话' })).toBeHidden();
      await expect(page.getByRole('button', { name: '服务详情', exact: true })).toHaveAttribute(
        'aria-expanded',
        'false'
      );
      await page.getByRole('heading', { name: '桌面控制工具', exact: true }).waitFor();
      assert.equal(await page.getByText('Windows-MCP', { exact: true }).count(), 0);
      assert.equal(await page.locator('footer, [data-slot="separator"], hr').count(), 0);
      assert.equal(
        await page
          .locator('.executor-titlebar-content')
          .evaluate((node) => getComputedStyle(node).getPropertyValue('-webkit-app-region')),
        'drag'
      );
      assert.equal(
        await page
          .getByRole('tablist', { name: '执行器页面' })
          .evaluate((node) => getComputedStyle(node).getPropertyValue('-webkit-app-region')),
        'no-drag'
      );
      await page.getByRole('button', { name: '服务详情', exact: true }).click();
      await page.getByRole('status').filter({ hasText: '暂无有效 MCP 会话' }).waitFor();
      await app.evaluate(({ clipboard }) => {
        clipboard.writeText = (value) => {
          globalThis.copiedConfiguration = value;
        };
      });
      const service = page
        .locator('[data-slot="collapsible"]')
        .filter({ has: page.getByTestId('mcp-endpoint') });
      const serviceBounds = await service.boundingBox();
      const copyEndpointButton = page.getByRole('button', { name: '复制连接地址' });
      const copiedToast = page.locator('[data-slot="toast"]').filter({ hasText: '连接地址已复制' });
      await copyEndpointButton.click();
      await copiedToast.waitFor();
      assert.deepEqual(await service.boundingBox(), serviceBounds);
      await expect(copyEndpointButton.locator('svg.lucide-check')).toBeVisible();
      await copyEndpointButton.click();
      await expect(copiedToast).toHaveCount(1);
      await expect(copyEndpointButton.locator('svg.lucide-copy')).toBeVisible();
      await expect(copiedToast).toHaveCount(0);
      assert.deepEqual(await service.boundingBox(), serviceBounds);
      const endpoint = (await page.evaluate(() => window.executor.readAccess())).data.endpoint;
      assert.equal(await app.evaluate(() => globalThis.copiedConfiguration), endpoint);
      await app.evaluate(({ clipboard }) => {
        clipboard.writeText = () => {
          throw new Error('Owned clipboard failure fixture');
        };
      });
      await copyEndpointButton.click();
      const failedCopyToast = page.locator('[data-slot="toast"]').filter({ hasText: '连接地址复制失败' });
      await failedCopyToast.waitFor();
      assert.deepEqual(await service.boundingBox(), serviceBounds);
      await expect(copyEndpointButton.locator('svg.lucide-copy')).toBeVisible();
      await failedCopyToast.hover();
      await failedCopyToast.getByRole('button', { name: 'Close toast' }).click();
      await copyEndpointButton.hover();
      await expect(failedCopyToast).toHaveCount(0);
      await app.evaluate(({ clipboard }) => {
        clipboard.writeText = (value) => {
          globalThis.copiedConfiguration = value;
        };
      });
      await page.getByRole('button', { name: '服务详情', exact: true }).click();
      const toolTitles = await Promise.all(
        ['基础工具', '浏览器桥接', '桌面控制工具'].map((name) =>
          page.getByRole('heading', { name, exact: true }).boundingBox()
        )
      );
      assert.equal(toolTitles[0].x, toolTitles[1].x);
      assert.equal(toolTitles[1].x, toolTitles[2].x);
      if (process.env.EXECUTOR_LAYOUT_CAPTURE) {
        await mkdir(process.env.EXECUTOR_LAYOUT_CAPTURE, { recursive: true });
        await page.screenshot({ path: join(process.env.EXECUTOR_LAYOUT_CAPTURE, 'status.png') });
      }
      await page.getByRole('button', { name: '服务详情', exact: true }).click();
      await page.getByRole('button', { name: '管理授权', exact: true }).click();
      await app.evaluate(({ dialog }) => {
        dialog.showSaveDialog = async () => {
          throw new Error('Creating grants must not request a save dialog');
        };
      });
      const instructions = page.getByRole('button', { name: '安装与连接说明', exact: true });
      assert.equal(await instructions.getAttribute('aria-expanded'), 'false');
      await page.getByRole('button', { name: '创建授权', exact: true }).click();
      await page.getByRole('checkbox', { name: '运行 PowerShell 命令' }).check();
      await page.getByText('PowerShell 以当前 Windows 用户权限执行命令', { exact: false }).waitFor();
      await page.getByRole('checkbox', { name: '运行 PowerShell 命令' }).uncheck();
      assert.equal(
        await page.getByRole('checkbox', { name: '控制浏览器网页', exact: true }).isDisabled(),
        true
      );
      await page.getByRole('button', { name: '高级选项', exact: true }).click();
      await page.getByRole('combobox', { name: '调用等待预算' }).click();
      await page.getByRole('option', { name: '600 秒', exact: true }).click();
      const height = await page
        .getByLabel('授权名称')
        .evaluate((node) => node.getBoundingClientRect().height);
      assert.equal(Math.round(height), 32);
      await page.getByRole('dialog').getByRole('button', { name: '创建授权', exact: true }).click();
      await page.locator('[data-slot="toast"]').filter({ hasText: '授权已创建' }).waitFor();
      const configure = page.getByRole('button', { name: '配置客户端', exact: true });
      assert.equal(await configure.getAttribute('aria-expanded'), 'false');
      await configure.click();
      assert.equal(await configure.locator('svg').evaluate((node) => getComputedStyle(node).rotate), '90deg');
      await page.getByRole('button', { name: '复制配置', exact: true }).click();
      await page.locator('[data-slot="toast"]').filter({ hasText: '配置已复制' }).waitFor();
      await expect(
        page.getByRole('button', { name: '复制配置', exact: true }).locator('svg.lucide-copy')
      ).toBeVisible();
      const config = JSON.parse(await app.evaluate(() => globalThis.copiedConfiguration));
      const token = Object.values(config.mcpServers)[0].headers.Authorization.slice(7);
      assert.equal((await page.locator('body').innerText()).includes(token), false);
      await page.getByRole('button', { name: '复制给智能体', exact: true }).click();
      await page.locator('[data-slot="toast"]').filter({ hasText: '连接文档已复制' }).waitFor();
      const guide = await app.evaluate(() => globalThis.copiedConfiguration);
      assert.ok(guide.includes('# Octopus Executor MCP 连接文档'));
      const blocks = [...guide.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => JSON.parse(match[1]));
      assert.deepEqual(blocks[1], config);
      const access = await page.evaluate(() => window.executor.readAccess());
      assert.equal(blocks[0].deviceId, access.data.device.deviceId);
      await expect(page.getByText('设备 ID：' + access.data.device.deviceId, { exact: true })).toBeVisible();
      assert.equal((await page.locator('body').innerText()).includes(token), false);
      assert.deepEqual(
        await page.evaluate(
          (clientId) =>
            window.executor
              .copyAgentGuide({
                clientId,
                transport: 'http',
                text: 'arbitrary clipboard content',
              })
              .catch(() => 'rejected'),
          access.data.clients[0].clientId
        ),
        'rejected'
      );
      await app.evaluate(({ dialog }) => {
        dialog.showSaveDialog = async () => ({ canceled: true });
      });
      await page.getByRole('button', { name: '下载配置文件', exact: true }).click();
      await page.getByRole('button', { name: '下载配置文件', exact: true }).waitFor();
      assert.equal(
        await page.locator('[data-slot="toast"]').filter({ hasText: '配置文件已下载' }).count(),
        0
      );
      assert.equal((await page.evaluate(() => window.executor.readAccess())).data.clients[0].revoked, false);
      assert.equal(await configure.getAttribute('aria-expanded'), 'true');
      await configure.click();
      await instructions.click();
      await page.getByRole('tab', { name: '应用商店安装', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: 'Chrome 商店 · 尚未上架' }).isDisabled(), true);
      await page.getByRole('tab', { name: '本地安装', exact: true }).click();
      await app.evaluate(({ shell }) => {
        shell.openPath = async (path) => {
          globalThis.openedExtensionFolder = path;
          return '';
        };
      });
      for (const [browser, name] of [
        ['chrome', 'Chrome'],
        ['edge', 'Edge'],
      ]) {
        await page.getByRole('button', { name: `打开 ${name} 插件目录`, exact: true }).click();
        await page.locator('[data-slot="toast"]').filter({ hasText: '插件目录已打开' }).waitFor();
        await expect
          .poll(() => app.evaluate(() => globalThis.openedExtensionFolder))
          .toBe(join(appRoot, `../browser-extension/.output/${browser}-mv3`));
        await expect(page.getByText(`在 ${name} 菜单中打开`, { exact: false })).toBeVisible();
      }
      await page.getByText('高级诊断', { exact: true }).click();
      await page.getByText('执行器数据目录：', { exact: false }).waitFor();
      await instructions.click();
      await page.getByRole('tab', { name: '设置', exact: true }).click();
      await page.getByLabel('MCP 服务端口').waitFor();
      await page.getByText('保存后立即生效', { exact: true }).waitFor();
      await page.getByText('保存并重启后生效', { exact: true }).first().waitFor();
      assert.equal(await page.getByText('无未保存的更改', { exact: true }).count(), 0);
      const settingsForm = page.locator('form').filter({
        has: page.getByLabel('MCP 服务端口', { exact: true }),
      });
      await expect(settingsForm.locator('[data-slot="separator"]')).toHaveCount(1);
      const controls = await Promise.all(
        ['界面主题', '关闭窗口时', 'MCP 服务端口'].map((label) =>
          page.getByLabel(label, { exact: true }).evaluate((node) => {
            const bounds = node.getBoundingClientRect();
            return { left: bounds.left, width: bounds.width, height: bounds.height };
          })
        )
      );
      assert.deepEqual(controls[0], controls[1]);
      assert.deepEqual(controls[1], controls[2]);
      assert.equal(controls[0].width, 240);
      assert.equal(controls[0].height, 32);
      const badgeStyles = await Promise.all(
        ['保存后立即生效', '保存并重启后生效'].map((text) =>
          page
            .getByText(text, { exact: true })
            .first()
            .evaluate((node) => {
              const style = getComputedStyle(node);
              return {
                background: style.backgroundColor,
                border: style.borderColor,
                radius: style.borderRadius,
                height: node.getBoundingClientRect().height,
              };
            })
        )
      );
      assert.deepEqual(badgeStyles[0], badgeStyles[1]);
      if (process.env.EXECUTOR_LAYOUT_CAPTURE) {
        await page.screenshot({ path: join(process.env.EXECUTOR_LAYOUT_CAPTURE, 'settings-light.png') });
        await page.emulateMedia({ colorScheme: null, reducedMotion: 'reduce' });
        await app.evaluate(({ nativeTheme }) => {
          nativeTheme.themeSource = 'dark';
        });
        await expect(page.locator('html')).toHaveClass('dark');
        await page.evaluate(
          () => new Promise((accept) => requestAnimationFrame(() => requestAnimationFrame(accept)))
        );
        await page.screenshot({ path: join(process.env.EXECUTOR_LAYOUT_CAPTURE, 'settings-dark.png') });
        await app.evaluate(({ nativeTheme }) => {
          nativeTheme.themeSource = 'system';
        });
        await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
      }
      assert.equal(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource), 'system');
      const navigation = await page.getByRole('tablist', { name: '执行器页面' }).boundingBox();
      const titlebar = await page.locator('header').boundingBox();
      assert.equal(titlebar.height, 72);
      assert.equal(navigation.y - titlebar.y, 20);
      assert.equal(titlebar.y + titlebar.height - navigation.y - navigation.height, 20);
      const captionHeight = await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.height = 'env(titlebar-area-height, 0px)';
        probe.style.position = 'absolute';
        document.body.append(probe);
        const height = probe.getBoundingClientRect().height;
        probe.remove();
        return height;
      });
      assert.ok(captionHeight > 0 && captionHeight <= 40, `Native caption height: ${captionHeight}`);
      assert.ok(captionHeight < titlebar.height);
      assert.ok(
        Math.abs(navigation.x + navigation.width / 2 - (await page.evaluate(() => innerWidth)) / 2) < 1
      );
      await page.getByRole('switch', { name: '允许内网 / VPN 客户端连接', exact: true }).click();
      await page.getByRole('status').filter({ hasText: '有未保存的更改' }).waitFor();
      await page.getByText('请选择本机内网 / VPN IPv4 地址。', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: '保存设置', exact: true }).isDisabled(), true);
      const addressBounds = await page.getByLabel('本机内网 / VPN IPv4 地址', { exact: true }).boundingBox();
      assert.equal(addressBounds.width, controls[0].width);
      assert.equal(addressBounds.x, controls[0].left);
      const addresses = (await page.evaluate(() => window.executor.readNetworkAddresses())).data;
      assert.ok(addresses.length > 0);
      await page.getByLabel('本机内网 / VPN IPv4 地址', { exact: true }).click();
      await page
        .getByRole('option', { name: `${addresses[0].interfaceName} · ${addresses[0].address}`, exact: true })
        .click();
      assert.equal(await page.getByText('请选择本机内网 / VPN IPv4 地址。', { exact: true }).count(), 0);
      await page.getByRole('switch', { name: '允许内网 / VPN 客户端连接', exact: true }).click();
      assert.equal(await page.getByText('有未保存的更改', { exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: '保存设置', exact: true }).isDisabled(), true);
      assert.equal((await page.evaluate(() => window.executor.readSettings())).data.closeBehavior, 'tray');
      assert.match(await page.getByRole('combobox', { name: '关闭窗口时' }).innerText(), /最小化到系统托盘/);
      const savedPort = await page.getByLabel('MCP 服务端口').inputValue();
      await page.getByLabel('MCP 服务端口').fill('70000');
      await page.getByText('请输入 1–65535 之间的整数端口。', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: '保存设置', exact: true }).isDisabled(), true);
      await page.getByLabel('MCP 服务端口').fill(savedPort);
      const pid = (await page.evaluate(() => window.executor.readStatus())).data.pid;
      await app.evaluate(async ({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.show();
        const hidden = new Promise((accept) => window.once('hide', accept));
        window.close();
        await hidden;
        window.show();
      });
      assert.equal((await page.evaluate(() => window.executor.readStatus())).data.pid, pid);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setMinimumSize(320, 560));
      for (const width of [720, 390, 320]) {
        await app.evaluate(
          ({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].setContentSize(value, 760),
          width
        );
        assert.equal(await page.evaluate(() => window.innerWidth), width);
        for (const name of ['状态', '连接', '设置']) {
          await page.getByRole('tab', { name, exact: true }).click();
          assert.equal(await page.locator('[data-slot="separator"]').count(), name === '设置' ? 1 : 0);
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
            true
          );
          assert.equal(
            await page.locator('main').evaluate((node) => node.scrollWidth <= node.clientWidth),
            true
          );
        }
        assert.equal(
          await page
            .getByRole('tablist', { name: '执行器页面' })
            .evaluate(
              (node) =>
                node.getBoundingClientRect().right <=
                document.querySelector('.executor-titlebar-content').getBoundingClientRect().right
            ),
          true
        );
      }
      assert.deepEqual(errors, []);
    } finally {
      await app.close();
      assert.ok(data.startsWith(join(tmpdir(), 'octopus-overview-')));
      await rm(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
);
