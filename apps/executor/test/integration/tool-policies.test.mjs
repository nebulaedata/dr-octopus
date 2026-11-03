/**
 * @author Codex
 * @description Verifies real policy IPC, editor interactions, restart-only activation and persistence using disposable Electron data.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { ConnectionSettings } from '../../src/main/connection-settings.ts';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';
import { _electron as electron, expect } from '@playwright/test';

const appRoot = resolve(
  process.env.EXECUTOR_POLICY_TEST_APP || fileURLToPath(new URL('../../', import.meta.url))
);

test(
  'policy editor creates, filters, copies, discards, deletes and loads persisted tool switches on restart',
  { timeout: 120000 },
  async () => {
    const data = await mkdtemp(join(tmpdir(), 'octopus-policy-ui-'));
    const errors = [];
    let app;
    /**
     * Starts only the test-owned app against an isolated project and waits for authoritative readiness.
     */
    async function launch() {
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      app = await electron.launch({
        cwd: appRoot,
        env,
        args: [appRoot, '--executor-test', '--executor-test-data=' + data],
      });
      const page = await app.firstWindow();
      page.setDefaultTimeout(15000);
      page.on('pageerror', (error) => errors.push(error.message));
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.setContentSize(1487, 1058);
        window.show();
        window.focus();
      });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      try {
        await expect
          .poll(async () => (await page.evaluate(() => window.executor.readStatus())).data?.state, {
            timeout: 45000,
          })
          .toBe('ready');
      } catch (error) {
        const status = await page.evaluate(() => window.executor.readStatus());
        console.error('Isolated startup status:', JSON.stringify(status));
        if (process.env.EXECUTOR_POLICY_EVIDENCE) {
          await mkdir(process.env.EXECUTOR_POLICY_EVIDENCE, { recursive: true });
          await writeFile(
            join(process.env.EXECUTOR_POLICY_EVIDENCE, 'failed-startup.json'),
            JSON.stringify(status, null, 2)
          );
        }
        throw error;
      }
      await page.getByRole('tab', { name: '设置', exact: true }).click();
      return page;
    }
    try {
      // The shared form now persists listener preferences too; reserve an isolated port instead of the daily app's default.
      const listener = createServer();
      await new Promise((resolve, reject) => {
        listener.once('error', reject);
        listener.listen(0, '127.0.0.1', resolve);
      });
      const port = listener.address().port;
      await new Promise((resolve, reject) => listener.close((error) => (error ? reject(error) : resolve())));
      const settings = await ConnectionSettings.open(
        new NativeFileCommit(join(appRoot, 'dist/native/file-commit.node')),
        join(data, 'project')
      );
      await settings.save({ port, networkAddress: null });
      let page = await launch();
      const initial = await page.evaluate(() => window.executor.readToolPolicies());
      assert.equal(initial.data.settings.selectedId, 'readonly');
      assert.equal(initial.data.activeSettings.selectedId, 'readonly');
      const chooser = page.getByRole('combobox', { name: '工具策略', exact: true });
      await expect(chooser).toContainText('只读');
      const cleanPolicyBorder = await chooser.evaluate((element) => getComputedStyle(element).borderTopColor);
      const saveSettings = page.getByRole('button', { name: '保存设置', exact: true });
      const undo = page.getByRole('button', { name: '撤销更改', exact: true });
      const policySection = page.getByRole('region', { name: '工具权限策略', exact: true });
      await expect(policySection.getByText('保存并重启后生效', { exact: true })).toBeVisible();
      await expect(saveSettings).toBeDisabled();
      await page.getByRole('button', { name: '编辑工具策略', exact: true }).click();
      const preset = page.getByRole('dialog', { name: '只读', exact: true });
      await expect(preset.getByRole('checkbox', { name: '写入文件', exact: true })).toBeDisabled();
      await expect(preset.getByRole('button', { name: '复制为自定义', exact: true })).toBeEnabled();
      await preset.getByRole('button', { name: 'Close', exact: true }).click();
      await chooser.click();
      await page.getByRole('option', { name: '全部', exact: true }).click();
      assert.equal(
        (await page.evaluate(() => window.executor.readToolPolicies())).data.settings.selectedId,
        'readonly'
      );
      assert.equal((await page.evaluate(() => window.executor.readSettings())).data.pendingRestart, false);
      await expect(saveSettings).toBeEnabled();
      const policyField = policySection.locator('[data-slot="field"]');
      await expect(policyField).toHaveAttribute('data-changed', 'true');
      assert.notEqual(
        await chooser.evaluate((element) => getComputedStyle(element).borderTopColor),
        cleanPolicyBorder
      );
      const actions = page.getByRole('group', { name: '设置操作', exact: true });
      await expect(actions.getByRole('button', { name: '撤销更改', exact: true })).toBeVisible();
      const undoBounds = await undo.boundingBox();
      const saveBounds = await saveSettings.boundingBox();
      assert.ok(Math.abs(undoBounds.y - saveBounds.y) < 1);
      assert.ok(saveBounds.x - undoBounds.x - undoBounds.width >= 0);
      assert.ok(saveBounds.x - undoBounds.x - undoBounds.width <= 12);
      if (process.env.EXECUTOR_POLICY_EVIDENCE) {
        await mkdir(process.env.EXECUTOR_POLICY_EVIDENCE, { recursive: true });
        await actions.scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(process.env.EXECUTOR_POLICY_EVIDENCE, 'dirty-actions.png') });
        await policySection.scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(process.env.EXECUTOR_POLICY_EVIDENCE, 'dirty-policy.png') });
      }

      await expect(page.getByText('有未保存的更改', { exact: true })).toBeVisible();
      await chooser.click();
      await page.getByRole('option', { name: '只读', exact: true }).click();
      await expect(saveSettings).toBeDisabled();
      await expect(policyField).toHaveAttribute('data-changed', 'false');
      await expect(page.getByText('有未保存的更改', { exact: true })).toHaveCount(0);
      await chooser.click();
      await page.getByRole('option', { name: '全部', exact: true }).click();
      await undo.click();
      await expect(chooser).toContainText('只读');
      await expect(saveSettings).toBeDisabled();
      await chooser.click();
      await page.getByRole('option', { name: '全部', exact: true }).click();
      const runtimePid = (await page.evaluate(() => window.executor.readStatus())).data.pid;
      await page.getByRole('combobox', { name: '界面主题', exact: true }).click();
      await page.getByRole('option', { name: '明亮', exact: true }).click();
      await saveSettings.click();
      await expect(saveSettings).toBeDisabled();
      assert.equal(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource), 'light');
      assert.equal((await page.evaluate(() => window.executor.readStatus())).data.pid, runtimePid);

      await expect
        .poll(
          async () =>
            (await page.evaluate(() => window.executor.readToolPolicies())).data?.settings.selectedId
        )
        .toBe('all');
      await expect(chooser).toBeEnabled();
      await chooser.click();
      await page.getByRole('option', { name: '新建策略…', exact: true }).click();
      const editor = page.getByRole('dialog', { name: '自定义策略', exact: true });
      await editor.getByLabel('策略名称', { exact: true }).fill('日常开发');
      await expect(editor.getByRole('checkbox', { name: '写入文件', exact: true })).not.toBeChecked();
      await editor.getByRole('checkbox', { name: '写入文件', exact: true }).check();
      await editor.getByRole('textbox', { name: '搜索工具', exact: true }).fill('grep');
      await expect(editor.getByRole('checkbox', { name: '搜索内容', exact: true })).toBeChecked();
      await expect(editor.getByRole('checkbox', { name: '写入文件', exact: true })).toHaveCount(0);
      await editor.getByRole('textbox', { name: '搜索工具', exact: true }).fill('');
      await expect(editor.getByRole('checkbox', { name: '写入文件', exact: true })).toBeChecked();
      await editor.getByRole('tab', { name: /^任务管理/ }).click();
      await expect(editor.getByRole('checkbox', { name: '开始任务', exact: true })).toBeChecked();
      await editor.getByRole('tab', { name: /^基础工具/ }).click();
      const evidence = process.env.EXECUTOR_POLICY_EVIDENCE;
      if (evidence) {
        await mkdir(evidence, { recursive: true });
        await page.screenshot({ path: join(evidence, 'editor-desktop.png') });
        await app.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0];
          window.setMinimumSize(480, 560);
          window.setContentSize(560, 700);
        });
        await expect(editor.getByRole('combobox', { name: '工具分类' })).toBeVisible();
        await expect
          .poll(async () =>
            editor.evaluate((element) => {
              const box = element.getBoundingClientRect();
              return box.top >= 0 && box.bottom <= window.innerHeight;
            })
          )
          .toBe(true);
        await page.screenshot({ path: join(evidence, 'editor-compact.png') });
        assert.equal(
          await editor.getByRole('tabpanel').evaluate((element) => element.scrollWidth > element.clientWidth),
          false
        );
        assert.equal(await editor.evaluate((element) => element.scrollWidth > element.clientWidth), false);
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].setContentSize(1487, 1058)
        );
      }
      await editor.getByRole('button', { name: '确认', exact: true }).click();
      await expect(editor).toHaveCount(0);
      assert.equal(
        (await page.evaluate(() => window.executor.readToolPolicies())).data.settings.custom.length,
        0
      );
      await expect(page.getByRole('button', { name: '立即重启', exact: true })).toBeDisabled();
      await saveSettings.click();
      await expect(saveSettings).toBeDisabled();
      const saved = await page.evaluate(() => window.executor.readToolPolicies());
      assert.equal(saved.data.activeSettings.selectedId, 'readonly');
      assert.equal((await page.evaluate(() => window.executor.readSettings())).data.pendingRestart, true);
      await expect(page.getByText('已保存的设置待重启生效', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '重新应用', exact: true })).toHaveCount(0);
      assert.equal(saved.data.settings.custom.length, 1);
      assert.ok(saved.data.settings.custom[0].enabledTools.includes('write'));
      const stale = await page.evaluate(async (toolPolicies) => {
        return window.executor.saveSettings({ port: 19876, networkAddress: null, toolPolicies });
      }, initial.data.settings);
      assert.equal(stale.ok, false);
      const invalid = await page.evaluate(async (settings) => {
        try {
          await window.executor.saveSettings({
            port: 19876,
            networkAddress: null,
            toolPolicies: { ...settings, selectedId: 'missing' },
          });
          return false;
        } catch {
          return true;
        }
      }, saved.data.settings);
      assert.equal(invalid, true);

      await page.getByRole('button', { name: '编辑工具策略', exact: true }).click();
      await editor.getByRole('checkbox', { name: '编辑文件', exact: true }).check();
      await editor.getByRole('button', { name: 'Close', exact: true }).click();
      const discard = page.getByRole('dialog', { name: '放弃未保存的修改？', exact: true });
      await discard.getByRole('button', { name: '继续编辑', exact: true }).click();
      await expect(editor.getByRole('checkbox', { name: '编辑文件', exact: true })).toBeChecked();
      await editor.getByRole('button', { name: 'Close', exact: true }).click();
      await discard.getByRole('button', { name: '放弃修改', exact: true }).click();
      await expect(editor).toHaveCount(0);
      assert.ok(
        !(
          await page.evaluate(() => window.executor.readToolPolicies())
        ).data.settings.custom[0].enabledTools.includes('edit')
      );

      await page.getByRole('button', { name: '编辑工具策略', exact: true }).click();
      await editor.getByRole('button', { name: '策略操作', exact: true }).click();
      await page.getByRole('menuitem', { name: '复制策略', exact: true }).click();
      await editor.getByRole('button', { name: '确认', exact: true }).click();
      await expect(editor).toHaveCount(0);
      await page.getByRole('button', { name: '编辑工具策略', exact: true }).click();
      await editor.getByRole('button', { name: '策略操作', exact: true }).click();
      await page.getByRole('menuitem', { name: '删除策略', exact: true }).click();
      await page
        .getByRole('dialog', { name: '删除这个策略？', exact: true })
        .getByRole('button', { name: '删除并使用只读', exact: true })
        .click();
      await expect(editor).toHaveCount(0);
      await expect(chooser).toContainText('只读');
      assert.equal(
        (await page.evaluate(() => window.executor.readToolPolicies())).data.settings.custom.length,
        1
      );
      await chooser.click();
      await page.getByRole('option', { name: '全部', exact: true }).click();
      await expect(saveSettings).toBeEnabled();
      await saveSettings.click();
      await expect(saveSettings).toBeDisabled();
      await expect
        .poll(
          async () => (await page.evaluate(() => window.executor.readToolPolicies())).data.settings.selectedId
        )
        .toBe('all');
      assert.equal(
        (await page.evaluate(() => window.executor.readToolPolicies())).data.activeSettings.selectedId,
        'readonly'
      );
      await expect(page.getByRole('button', { name: '立即重启', exact: true })).toBeEnabled();
      if (evidence) {
        await page.screenshot({ path: join(evidence, 'settings-pending-restart.png') });
      }
      await app.close();
      app = undefined;
      page = await launch();
      const reopened = await page.evaluate(() => window.executor.readToolPolicies());
      assert.equal(reopened.data.settings.selectedId, 'all');
      assert.equal(reopened.data.settings.custom.length, 1);
      assert.equal(reopened.data.activeSettings.selectedId, 'all');
      assert.equal((await page.evaluate(() => window.executor.readSettings())).data.pendingRestart, false);
      await expect(page.getByText('已保存的设置待重启生效', { exact: true })).toHaveCount(0);
      assert.deepEqual(errors, []);
    } finally {
      await app?.close();
      assert.ok(data.startsWith(join(tmpdir(), 'octopus-policy-ui-')));
      await rm(data, { recursive: true, force: true });
    }
  }
);
