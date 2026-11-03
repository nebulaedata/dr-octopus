/**
 * @author Codex
 * @description Verifies real extension-to-Native Skill persistence and PageController replay with a local synthetic provider in isolated profiles.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { _electron as electron, chromium, expect } from '@playwright/test';
import { createBrowserHostFixture } from './browser-host.mjs';
import { createSkillProvider } from './browser-skill-provider.mjs';
import { browserIdentity } from '../../build/browser-identity.ts';

const appRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
/* global chrome */
test(
  'Chrome and Edge record, organize, save, reload edited skills and replay through the real Native bridge',
  { timeout: 300000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'octopus-skills-e2e-'));
    const data = join(root, 'data');
    const evidence = join(appRoot, 'build/validation-evidence/browser-skills', new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).replaceAll('-','') + '-' + randomUUID());
    await mkdir(data);
    await mkdir(evidence, { recursive: true });
    const provider = await createSkillProvider();
    const fixture = await createBrowserHostFixture({ root, appRoot, userData: data });
    let app;
    let registered = false;
    const contexts = [];
    const report = [];
    try {
      await fixture.register('install');
      registered = true;
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      app = await electron.launch({
        cwd: appRoot,
        env,
        args: [appRoot, '--executor-test', '--executor-test-data=' + data],
      });
      const executor = await app.firstWindow();
      await executor.waitForFunction(
        async () => (await window.executor.readStatus()).data?.state === 'ready'
      );
      await executor.getByRole('tab', { name: '连接', exact: true }).click();
      await executor.getByRole('switch', { name: '浏览器桥接', exact: true }).click();
      await expect(executor.getByRole('switch', { name: '浏览器桥接', exact: true })).toBeChecked();
      await app.evaluate(({ shell }) => {
        globalThis.__openedSkillDirectories = [];
        shell.openPath = async (path) => {
          globalThis.__openedSkillDirectories.push(path);
          return '';
        };
      });
      for (const flavor of ['chrome', 'edge']) {
        provider.control.requireEditedSkill = false;
        const extension = await fixture.extensionDirectory(flavor);
        const context = await chromium.launchPersistentContext(join(root, flavor), {
          executablePath:
            flavor === 'chrome'
              ? join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe')
              : join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'),
          headless: false,
          ignoreDefaultArgs: ['--disable-extensions'],
          args: ['--enable-unsafe-extension-debugging', '--window-position=-2000,-2000', '--no-first-run'],
        });
        contexts.push(context);
        const cdp = await context.browser().newBrowserCDPSession();
        const { id } = await cdp.send('Extensions.loadUnpacked', { path: extension });
        assert.equal(id, browserIdentity.sideloadExtensionId);
        const worker =
          context.serviceWorkers().find((item) => item.url().includes(id)) ??
          (await context.waitForEvent('serviceworker'));
        await expect
          .poll(
            () => worker.evaluate(async () => (await chrome.storage.local.get('bridgeStatus')).bridgeStatus),
            { timeout: 20000 }
          )
          .toBe('connected');
        const business = await context.newPage();
        await business.goto(provider.url + '/orders');
        const popup = await context.newPage();
        await popup.setViewportSize({ width: 360, height: 600 });
        await business.bringToFront();
        await popup.goto(`chrome-extension://${id}/popup.html`);
        await expect(popup.getByRole('tab')).toHaveCount(2);
        await expect(popup.getByRole('tab').first()).toHaveText('连接状态');
        await popup.getByRole('button', { name: '模型设置', exact: true }).click();
        await popup.getByLabel('接口地址', { exact: true }).fill(provider.url + '/v1');
        await popup.getByLabel('API Key', { exact: true }).fill('synthetic-local-only');
        await popup.getByLabel('模型', { exact: true }).fill('synthetic-tool-model');
        await popup.getByLabel('模型', { exact: true }).press('Escape');
        await popup.getByRole('checkbox').check();
        await popup.getByRole('button', { name: '保存配置', exact: true }).click();
        await expect(popup.getByRole('group', { name: 'API Key 已保存' })).toBeVisible();
        await popup.getByRole('button', { name: '返回', exact: true }).click();
        await popup.getByRole('button', { name: '暂停连接', exact: true }).click();
        await expect
          .poll(() => worker.evaluate(async () => (await chrome.storage.local.get('paused')).paused))
          .toBe(true);
        await business.bringToFront();
        await popup.getByRole('tab', { name: '录制重放', exact: true }).click();
        await popup.getByRole('button', { name: '开始录制', exact: true }).click();
        const toolbar = business.getByRole('region', { name: 'Dr.Octopus 录制工具栏' });
        await expect(toolbar).toBeVisible();
        await business.getByRole('textbox', { name: '订单编号', exact: true }).fill('SEED-001');
        await business.getByRole('button', { name: '查询', exact: true }).click();
        await toolbar.getByRole('button', { name: '停止并保存', exact: true }).click();
        await expect(toolbar).toHaveCount(0);
        await popup.getByRole('button', { name: /订单查询测试录制/ }).click();
        await expect(popup.getByRole('button', { name: '开始整理', exact: true })).toBeEnabled();
        await expect(popup.getByRole('button', { name: '重放', exact: true })).toBeDisabled();
        await popup.screenshot({ path: join(evidence, flavor + '-detail.png') });
        await popup.getByRole('button', { name: '开始整理', exact: true }).click();
        await expect(popup.getByText('这个流程按什么编号查询？', { exact: true })).toBeVisible({
          timeout: 25000,
        });
        await popup.getByRole('radio', { name: '订单编号', exact: true }).check();
        await popup.screenshot({ path: join(evidence, flavor + '-organize-question.png') });
        await popup.getByRole('button', { name: '确认并继续', exact: true }).click();
        await expect(popup.getByText('已完成', { exact: true })).toBeVisible({ timeout: 25000 });
        await popup.getByRole('button', { name: '返回录制', exact: true }).click();
        await expect(popup.getByRole('button', { name: '重放', exact: true })).toBeEnabled();
        await expect(popup.getByText('已保存到浏览器', { exact: true })).toBeVisible();
        const downloaded = popup.waitForEvent('download');
        await popup.getByRole('button', { name: '导出技能', exact: true }).click();
        const archive = unzipSync(await readFile(await (await downloaded).path()));
        assert.deepEqual(Object.keys(archive).sort(), ['SKILL.md', 'workflow.json']);
        assert.ok(strFromU8(archive['SKILL.md']).includes('name: 订单查询'));
        assert.equal(
          JSON.stringify(Object.values(archive).map(bytes=>strFromU8(bytes))).includes('synthetic-local-only'),
          false
        );
        await business.reload();
        await popup.getByRole('button', { name: '重放', exact: true }).click();
        await popup.getByRole('button', { name: '允许并继续', exact: true }).click();
        await expect(popup.getByText('这次查询哪个订单？', { exact: true })).toBeVisible({ timeout: 25000 });
        await popup.getByRole('textbox', { name: '订单编号', exact: true }).fill('000123');
        await popup.getByRole('button', { name: '确认并继续', exact: true }).click();
        await expect(popup.getByText('已结束', { exact: true })).toBeVisible({ timeout: 30000 });
        await expect(business.locator('#result')).toHaveText('订单000123：待处理');
        assert.equal(await business.evaluate(() => window.queryCount), 1);
        await popup.screenshot({ path: join(evidence, flavor + '-offline-result.png') });
        await popup.getByRole('button', { name: '返回录制', exact: true }).click();
        await popup.getByRole('tab', { name: '连接状态', exact: true }).click();
        await popup.getByRole('button', { name: '恢复连接', exact: true }).click();
        await expect
          .poll(
            () => worker.evaluate(async () => (await chrome.storage.local.get('bridgeStatus')).bridgeStatus),
            { timeout: 20000 }
          )
          .toBe('connected');
        await popup.getByRole('tab', { name: '录制重放', exact: true }).click();
        await popup.getByRole('button', { name: '技能文件操作', exact: true }).click();
        await popup.getByRole('menuitem', { name: '保存到本地目录', exact: true }).click();
        await expect(popup.getByText('已关联本地目录', { exact: true })).toBeVisible();
        await popup.getByRole('button', { name: '查看 SKILLS', exact: true }).click();
        await expect
          .poll(() => app.evaluate(() => globalThis.__openedSkillDirectories.length))
          .toBe(report.length + 1);
        const directories = await app.evaluate(() => globalThis.__openedSkillDirectories);
        const directory = directories.at(-1);
        assert.ok(directory.startsWith(join(data, 'project', 'skills', 'browser-recordings')));
        const original = await readFile(join(directory, 'SKILL.md'), 'utf8');
        await writeFile(
          join(directory, 'SKILL.md'),
          original +
            '\n用户维护标记：只查询，不修改数据。查询后打开同站点 /receipt 只读回执页，观察后关闭该页。'
        );
        provider.control.requireEditedSkill = true;
        await popup.getByRole('button', { name: '整理历史', exact: true }).click();
        await popup.getByRole('button', { name: /订单查询测试录制/ }).click();
        await expect(popup.getByLabel('整理技能导航').getByText('已完成', { exact: true })).toBeVisible();
        await popup.getByLabel('整理技能导航').getByRole('button', { name: '返回', exact: true }).click();
        await popup.getByLabel('整理历史导航').getByRole('button', { name: '返回', exact: true }).click();
        await business.reload();
        await popup.getByRole('button', { name: '重放', exact: true }).click();
        await popup.getByRole('button', { name: '允许并继续', exact: true }).click();
        await expect(popup.getByText('这次查询哪个订单？', { exact: true })).toBeVisible({ timeout: 25000 });
        await popup.getByRole('textbox', { name: '订单编号', exact: true }).fill('000123');
        await popup.setViewportSize({ width: 360, height: 460 });
        await expect(popup.getByRole('button', { name: '确认并继续', exact: true })).toBeInViewport();
        await popup.screenshot({ path: join(evidence, flavor + '-replay-short.png') });
        await popup.setViewportSize({ width: 360, height: 600 });
        await popup.getByRole('button', { name: '确认并继续', exact: true }).click();
        await expect(popup.getByText('已结束', { exact: true })).toBeVisible({ timeout: 30000 });
        await expect(business.locator('#result')).toHaveText('订单000123：待处理');
        assert.equal(await business.evaluate(() => window.queryCount), 1);
        assert.equal(
          context.pages().some((page) => page.url() === provider.url + '/receipt'),
          false
        );
        await popup.screenshot({ path: join(evidence, flavor + '-result.png') });
        report.push({ flavor, directory, queryCount: 1 });
        await context.close();
        contexts.pop();
      }
      assert.deepEqual(provider.errors, []);
      await writeFile(
        join(evidence, 'result.json'),
        JSON.stringify(
          {
            report,
            calls: provider.calls,
            nativeDirectoryDispatch:
              'Main shell.openPath intercepted after path validation; Explorer UI not launched',
            realProviderRequests: 0,
          },
          null,
          2
        )
      );
    } catch (error) {
      await writeFile(
        join(evidence, 'failure.json'),
        JSON.stringify(
          { message: error.message, providerErrors: provider.errors, calls: provider.calls },
          null,
          2
        )
      );
      for (const [index, context] of contexts.entries()) {
        const popup = context.pages().find((page) => page.url().includes('/popup.html'));
        await popup?.screenshot({ path: join(evidence, 'failure-' + index + '.png') }).catch(() => {});
        if (popup) {
          await writeFile(
            join(evidence, 'failure-' + index + '.txt'),
            await popup
              .locator('body')
              .textContent()
              .catch(() => 'unavailable')
          );
        }
      }
      throw error;
    } finally {
      for (const context of contexts) {
        await context.close();
      }
      await app?.close();
      if (registered) {
        await fixture.register('remove');
      }
      await new Promise((resolve) => provider.server.close(resolve));
      console.log('Browser Skill evidence:', evidence);
      await cp(join(data, 'project', 'skills'), join(evidence, 'skills'), { recursive: true }).catch(
        () => {}
      );
    }
  }
);
