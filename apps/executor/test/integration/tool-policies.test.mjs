/**
 * @author Codex
 * @description Verifies real policy IPC, editor interactions, immediate application and persistence using disposable Electron data.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect } from '@playwright/test';

const appRoot = resolve(
  process.env.EXECUTOR_POLICY_TEST_APP || fileURLToPath(new URL('../../', import.meta.url))
);

test(
  'policy editor creates, filters, copies, discards, deletes and reapplies persisted tool switches',
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
      await expect
        .poll(async () => (await page.evaluate(() => window.executor.readStatus())).data?.state, {
          timeout: 45000,
        })
        .toBe('ready');
      await page.getByRole('tab', { name: '设置', exact: true }).click();
      return page;
    }
    try {
      let page = await launch();
      const initial = await page.evaluate(() => window.executor.readToolPolicies());
      assert.equal(initial.data.settings.selectedId, 'readonly');
      assert.equal(initial.data.applied, true);
      const chooser = page.getByRole('combobox', { name: '工具权限策略', exact: true });
      await expect(chooser).toContainText('只读');
      await page.getByRole('button', { name: '编辑工具策略', exact: true }).click();
      const preset = page.getByRole('dialog', { name: '只读', exact: true });
      await expect(preset.getByRole('checkbox', { name: '写入文件', exact: true })).toBeDisabled();
      await expect(preset.getByRole('button', { name: '复制为自定义', exact: true })).toBeEnabled();
      await preset.getByRole('button', { name: 'Close', exact: true }).click();
      await chooser.click();
      await page.getByRole('option', { name: '全部', exact: true }).click();
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
      await editor.getByRole('button', { name: '保存并应用', exact: true }).click();
      await expect(editor).toHaveCount(0);
      const saved = await page.evaluate(() => window.executor.readToolPolicies());
      assert.equal(saved.data.applied, true);
      assert.equal(saved.data.settings.custom.length, 1);
      assert.ok(saved.data.settings.custom[0].enabledTools.includes('write'));
      const stale = await page.evaluate(
        (settings) => window.executor.saveToolPolicies(settings),
        initial.data.settings
      );
      assert.equal(stale.ok, false);
      const invalid = await page.evaluate(async (settings) => {
        try {
          await window.executor.saveToolPolicies({ ...settings, selectedId: 'missing' });
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
      await editor.getByRole('button', { name: '保存并应用', exact: true }).click();
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
      await app.close();
      app = undefined;
      page = await launch();
      const reopened = await page.evaluate(() => window.executor.readToolPolicies());
      assert.equal(reopened.data.settings.selectedId, 'readonly');
      assert.equal(reopened.data.settings.custom.length, 1);
      assert.equal(reopened.data.applied, true);
      assert.deepEqual(errors, []);
    } finally {
      await app?.close();
      assert.ok(data.startsWith(join(tmpdir(), 'octopus-policy-ui-')));
      await rm(data, { recursive: true, force: true });
    }
  }
);
