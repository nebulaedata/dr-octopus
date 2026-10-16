/**
 * @author Codex
 * @description Verifies rendered transfer settings, isolated formal storage and active limits changing only after restart.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createClientConfiguration } from './client-configuration.mjs';

const appRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));

/**
 * Opens only the test-owned instance and tracks actual renderer exceptions throughout the settings flow.
 */
async function launch(root, errors) {
  const app = await electron.launch({
    cwd: appRoot,
    args: [appRoot, '--executor-test', '--executor-test-data=' + root],
  });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByTestId('runtime-state').filter({ hasText: '已启动' }).waitFor();
    await page.getByRole('tab', { name: '设置', exact: true }).click();
    assert.equal(await page.title(), 'Dr.Octopus Executor v0.0.1');
    assert.ok(page.url().startsWith('app://ui/'));
    return { app, page };
  } catch (error) {
    await app.close();
    throw error;
  }
}

/**
 * Obtains a dedicated test grant through the owned Runtime and connects a real MCP client.
 */
async function connect(app, root, name) {
  const page = await app.firstWindow();
  const path = join(root, name + '.json');
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, path);
  await createClientConfiguration(page, { label: name, permissions: ['files.read'], waitBudgetMs: 120000 });
  const config = Object.values(JSON.parse(await readFile(path, 'utf8')).mcpServers)[0];
  const client = new Client({ name: 'settings-limits-test', version: '1' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers } })
  );
  return client;
}

test(
  'transfer settings validate, persist to project/settings.json and activate after full restart',
  { timeout: 120000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'octopus-transfer-settings-ui-'));
    const screenshots = await mkdtemp(join(tmpdir(), 'octopus-transfer-settings-screens-'));
    const errors = [];
    let current;
    let client;
    try {
      current = await launch(root, errors);
      client = await connect(current.app, root, 'before-restart');
      const { page } = current;
      await page
        .getByRole('region', { name: '应用设置' })
        .getByRole('heading', { name: '文件传输', exact: true })
        .scrollIntoViewIfNeeded();
      const save = page.getByRole('button', { name: '保存设置', exact: true });
      await page.getByLabel('上传单文件上限（MiB）', { exact: true }).fill('2049');
      await expect(save).toBeDisabled();
      await expect(page.getByText('请输入 1–2048 之间的整数。', { exact: true })).toBeVisible();
      await page.getByLabel('上传单文件上限（MiB）', { exact: true }).fill('32');
      await page.getByLabel('下载单文件上限（MiB）', { exact: true }).fill('64');
      await page.getByLabel('临时存储总额度（MiB）', { exact: true }).fill('63');
      await expect(save).toBeDisabled();
      await page.getByLabel('临时存储总额度（MiB）', { exact: true }).fill('128');
      await page.getByLabel('最低剩余磁盘空间（MiB）', { exact: true }).fill('16');
      const endpoint = (await page.evaluate(() => window.executor.readAccess())).data.endpoint;
      await page.getByLabel('MCP 服务端口').fill(new URL(endpoint).port);
      await expect(save).toBeEnabled();
      await save.click();
      await page.locator('[data-slot="toast"]').filter({ hasText: '设置已保存。' }).waitFor();
      const expected = {
        uploadLimitMiB: 32,
        downloadLimitMiB: 64,
        temporaryQuotaMiB: 128,
        minimumFreeSpaceMiB: 16,
      };
      const settings = await page.evaluate(() => window.executor.readSettings());
      assert.deepEqual(settings.data.transfer, expected);
      assert.equal(settings.data.pendingRestart, true);
      const active = await client.callTool({ name: 'runtime_status', arguments: {} });
      assert.equal(active.structuredContent.data.transferLimits.uploadLimitMiB, 2048);
      const formal = JSON.parse(await readFile(join(root, 'project', 'settings.json'), 'utf8'));
      assert.deepEqual(formal.transfer, expected);
      await page
        .locator('section[aria-labelledby="transfer-settings-heading"]')
        .screenshot({ path: join(screenshots, 'transfer-settings.png') });
      await client.close();
      client = undefined;
      await current.app.close();
      current = undefined;
      current = await launch(root, errors);
      const restarted = await current.page.evaluate(() => window.executor.readSettings());
      assert.deepEqual(restarted.data.transfer, expected);
      assert.equal(restarted.data.pendingRestart, false);
      await expect(current.page.getByLabel('上传单文件上限（MiB）', { exact: true })).toHaveValue('32');
      client = await connect(current.app, root, 'after-restart');
      const activated = await client.callTool({ name: 'runtime_status', arguments: {} });
      assert.deepEqual(activated.structuredContent.data.transferLimits, expected);
      await current.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(560, 850));
      await current.page
        .getByRole('region', { name: '应用设置' })
        .getByRole('heading', { name: '文件传输', exact: true })
        .scrollIntoViewIfNeeded();
      await current.page
        .locator('section[aria-labelledby="transfer-settings-heading"]')
        .screenshot({ path: join(screenshots, 'transfer-settings-narrow.png') });
      assert.deepEqual(errors, []);
      console.log('Settings screenshots:', screenshots);
    } finally {
      await client?.close();
      await current?.app.close();
      await rm(root, { recursive: true, force: true });
    }
  }
);
