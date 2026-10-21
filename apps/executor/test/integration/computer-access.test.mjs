/**
 * @author Codex
 * @description Verifies actual desktop readiness, explicit UI grants, MCP discovery and loss of the owned backend without sending desktop input.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { _electron as electron, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { downloadCreatedConfiguration } from './client-configuration.mjs';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));

/**
 * Requires a successful structured MCP reply and never prints credentials or desktop content.
 */
async function call(client, name, input = {}) {
  const reply = await client.callTool({ name, arguments: input });
  assert.notEqual(reply.isError, true, JSON.stringify(reply));
  return reply.structuredContent.data;
}

test(
  'desktop readiness and grants are truthful; backend loss removes tools and disables new desktop grants',
  { timeout: 90000 },
  async () => {
    const data = await mkdtemp(join(tmpdir(), 'octopus-computer-access-'));
    let app;
    let client;
    try {
      app = await electron.launch({
        cwd: root,
        args: [root, '--executor-test', '--executor-test-data=' + data],
      });
      const page = await app.firstWindow();
      page.setDefaultTimeout(15000);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') {
          errors.push(message.text());
        }
      });
      assert.equal(new URL(page.url()).protocol, 'app:');
      assert.ok((await page.title()).includes('Dr.Octopus'));
      await expect
        .poll(
          () =>
            page.evaluate(
              async () => (await window.executor.readStatus()).data?.capabilities.computer.available
            ),
          { timeout: 45000 }
        )
        .toBe(true);
      const desktopRow = page.getByRole('button', { name: '查看桌面控制工具', exact: true });
      await expect(desktopRow).not.toContainText('支持 9 项');
      await expect(desktopRow.getByText('已就绪', { exact: true })).toBeVisible();
      await desktopRow.click();
      await expect(page.getByRole('dialog').getByText(/当前状态：已就绪/)).toBeVisible();
      await expect(page.getByRole('dialog').getByText('computer.snapshot', { exact: true })).toBeVisible();
      await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
      if (process.env.EXECUTOR_COMPUTER_CAPTURE) {
        await mkdir(process.env.EXECUTOR_COMPUTER_CAPTURE, { recursive: true });
        await page.screenshot({
          animations: 'disabled',
          path: join(process.env.EXECUTOR_COMPUTER_CAPTURE, 'desktop-ready.png'),
        });
      }
      await page.getByRole('tab', { name: '连接', exact: true }).click();
      await page.getByRole('button', { name: '创建授权', exact: true }).click();
      await expect(page.getByRole('checkbox', { name: '桌面控制（含截图）', exact: true })).toBeEnabled();
      await page.getByRole('checkbox', { name: '读取与搜索文件', exact: true }).uncheck();
      await page.getByRole('checkbox', { name: '桌面控制（含截图）', exact: true }).check();
      await page.getByRole('dialog').getByRole('button', { name: '创建授权', exact: true }).click();
      await page.locator('[data-slot="toast"]').filter({ hasText: '授权已创建' }).waitFor();
      const output = join(data, 'desktop-config.json');
      await app.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath });
      }, output);
      const clientId = await downloadCreatedConfiguration(page);
      const configuration = JSON.parse(await readFile(output, 'utf8'));
      const connection = Object.values(configuration.mcpServers)[0];
      const grant = (await page.evaluate(() => window.executor.readAccess())).data.clients.find(
        (entry) => entry.clientId === clientId
      );
      assert.deepEqual([...grant.permissions].sort(), ['computer.control']);
      assert.equal(
        (await page.locator('body').innerText()).includes(connection.headers.Authorization),
        false
      );
      client = new Client({ name: 'desktop-admission-test', version: '1.0.0' });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(connection.url), {
          requestInit: { headers: connection.headers },
        })
      );
      assert.equal((await call(client, 'runtime_status')).computer.available, true);
      const names = (await client.listTools()).tools
        .map((tool) => tool.name)
        .filter((name) => name.startsWith('computer.'))
        .sort();
      assert.deepEqual(names, [
        'computer.app.switch',
        'computer.click',
        'computer.control.status',
        'computer.display.list',
        'computer.screenshot',
        'computer.scroll',
        'computer.shortcut',
        'computer.snapshot',
        'computer.type',
      ]);
      const task = await call(client, 'task_start', {
        capabilities: ['computer.control'],
        idempotencyKey: 'desktop-observe-only',
      });
      const result = await call(client, 'computer.control.status', { taskId: task.taskId });
      assert.ok(result.control.state);

      const runtimePid = (await page.evaluate(() => window.executor.readStatus())).data.pid;
      assert.ok(Number.isInteger(runtimePid) && runtimePid > 0);
      const command = `Get-CimInstance Win32_Process -Filter 'ParentProcessId=${runtimePid}' | Where-Object Name -eq 'computer-supervisor.exe' | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress`;
      const { stdout } = await promisify(execFile)(
        join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-Command', command],
        { windowsHide: true, timeout: 10000 }
      );
      const supervisor = JSON.parse(stdout);
      assert.ok(!Array.isArray(supervisor) && Number.isInteger(supervisor.ProcessId));
      assert.equal(
        resolve(supervisor.ExecutablePath).toLowerCase(),
        join(root, 'dist/native/computer-supervisor.exe').toLowerCase()
      );
      process.kill(supervisor.ProcessId);
      await expect
        .poll(
          () =>
            page.evaluate(async () => (await window.executor.readStatus()).data?.capabilities.computer.state),
          { timeout: 15000 }
        )
        .toBe('unavailable');
      assert.equal((await call(client, 'runtime_status')).computer.available, false);
      assert.deepEqual(
        (await client.listTools()).tools.filter((tool) => tool.name.startsWith('computer.')),
        []
      );
      await page.getByRole('tab', { name: '状态', exact: true }).click();
      await expect(desktopRow).not.toContainText('支持 9 项');
      await expect(desktopRow.getByText('未就绪', { exact: true })).toBeVisible();
      await desktopRow.click();
      await expect(page.getByRole('dialog').getByText(/当前状态：不可用/)).toBeVisible();
      await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
      if (process.env.EXECUTOR_COMPUTER_CAPTURE) {
        await page.screenshot({
          animations: 'disabled',
          path: join(process.env.EXECUTOR_COMPUTER_CAPTURE, 'desktop-disconnected.png'),
        });
      }
      await page.getByRole('tab', { name: '连接', exact: true }).click();
      await page.getByRole('button', { name: '创建授权', exact: true }).click();
      await expect(page.getByRole('checkbox', { name: '桌面控制（含截图）', exact: true })).toBeDisabled();
      assert.deepEqual(errors, []);
    } finally {
      await client?.close();
      await app?.close();
      assert.ok(data.startsWith(join(tmpdir(), 'octopus-computer-access-')));
      await rm(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
);
