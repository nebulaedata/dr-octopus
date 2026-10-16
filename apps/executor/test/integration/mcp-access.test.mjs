/**
 * @author Codex
 * @description Exercises built Electron native approval, private export and real SDK seven-tool calls on one Utility Runtime.
 */
import { downloadCreatedConfiguration } from './client-configuration.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createRequire } from 'node:module';
import { _electron as electron, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const appRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));

/**
 * Owns isolated Electron user data and all exported test credentials, with no user-directory interaction.
 */
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'octopus-mcp-electron-'));
  const data = join(root, 'data');
  const workspace = join(root, '中文 workspace');
  await mkdir(data);
  await mkdir(workspace);
  const app = await electron.launch({
    cwd: appRoot,
    args: [appRoot, '--executor-test', '--executor-test-data=' + data],
  });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByTestId('runtime-state').filter({ hasText: '已启动' }).waitFor();
    await page.getByRole('tab', { name: '连接', exact: true }).click();
    try {
      await run({ app, page, root, workspace, data });
    } catch (error) {
      throw new Error('Electron UI: ' + (await page.locator('body').innerText()), { cause: error });
    }
  } finally {
    await app.close().catch(() => {});
    assert.ok(root.startsWith(join(tmpdir(), 'octopus-mcp-electron-')));
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

/**
 * Substitutes only OS dialog choices in the test process; all production IPC, export and authorization paths run.
 */
async function selections(app, output, cancelled = false) {
  await app.evaluate(
    ({ dialog }, values) => {
      dialog.showOpenDialog = async () => {
        throw new Error('Device authorization must not request a directory');
      };
      dialog.showSaveDialog = async () => ({ canceled: values.cancelled, filePath: values.output });
    },
    { output, cancelled }
  );
}

/**
 * Returns confirmed SDK tool envelopes and includes safe errors in assertion diagnostics.
 */
async function call(client, name, args = {}) {
  const reply = await client.callTool({ name, arguments: args });
  assert.notEqual(reply.isError, true, JSON.stringify(reply));
  return reply.structuredContent.data;
}

test(
  'production desktop grants and exports privately, serves seven tools and revokes without Renderer credentials',
  { timeout: 60000 },
  async () => {
    await fixture(async ({ app, page, root, workspace, data }) => {
      await page.context().setOffline(true);
      const output = join(root, 'connection.json');
      await selections(app, output);
      await page.getByRole('button', { name: '创建授权', exact: true }).click();
      await page.getByRole('checkbox', { name: '写入与编辑文件（包含读取）', exact: true }).check();
      await page.getByRole('checkbox', { name: '运行 PowerShell 命令', exact: true }).check();
      await page.getByRole('dialog').getByRole('button', { name: '创建授权', exact: true }).click();
      await page.locator('[data-slot="toast"]').filter({ hasText: '授权已创建' }).waitFor();
      await downloadCreatedConfiguration(page);
      const config = JSON.parse(await readFile(output, 'utf8'));
      const server = Object.values(config.mcpServers)[0];
      const token = server.headers.Authorization.slice(7);
      const safe = await page.evaluate(() => window.executor.readAccess());
      assert.equal(safe.ok, true);
      assert.equal(config.scope, 'device');
      assert.equal('workspaceId' in config, false);
      assert.equal(safe.data.clients[0].scope, 'device');
      assert.equal('root' in safe.data.clients[0], false);
      assert.equal('workspaceId' in safe.data.clients[0], false);
      assert.equal(JSON.stringify(safe).includes(token), false);
      assert.equal((await page.locator('body').innerText()).includes(token), false);
      // Main already checked the write result; independently inspect the actual protected file from Node.
      const binary = join(appRoot, 'dist', 'native', 'file-commit.node');
      assert.equal((await createRequire(binary)(binary).inspect(output)).privateAcl, true);
      const client = new Client({ name: 'electron-validation', version: '1' });
      await page.getByRole('tab', { name: '状态', exact: true }).click();
      await page.getByRole('button', { name: '服务详情', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: '暂无有效 MCP 会话' })).toBeVisible();
      await expect
        .poll(async () => {
          const reply = await page.evaluate(() => window.executor.readAccess());
          return reply.ok ? reply.data.connections.reduce((total, item) => total + item.sessions, 0) : null;
        })
        .toBe(0);
      await client.connect(
        new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } })
      );
      try {
        await expect
          .poll(async () => {
            const reply = await page.evaluate(() => window.executor.readAccess());
            return reply.ok ? reply.data.connections.reduce((total, item) => total + item.sessions, 0) : null;
          })
          .toBe(1);
        await expect(page.getByText('以下客户端持有有效 MCP 会话。', { exact: true })).toBeVisible();
        await page
          .getByRole('region', { name: '客户端会话' })
          .screenshot({ path: join(appRoot, 'build', 'client-session-items.png') });
        await expect(
          page.getByText('有效会话不代表实时在线；连接关闭后，会话可能暂时保留，待空闲回收。', {
            exact: true,
          })
        ).toBeVisible();
        const second = new Client({ name: 'second-session', version: '1' });
        const secondTransport = new StreamableHTTPClientTransport(new URL(server.url), {
          requestInit: { headers: server.headers },
        });
        try {
          await second.connect(secondTransport);
          await expect
            .poll(async () => {
              const reply = await page.evaluate(() => window.executor.readAccess());
              return reply.ok
                ? reply.data.connections.reduce((total, item) => total + item.sessions, 0)
                : null;
            })
            .toBe(2);
          await expect(page.getByRole('list', { name: '有效会话客户端' }).getByRole('listitem')).toHaveCount(
            1
          );
          await secondTransport.terminateSession();
          await expect
            .poll(async () => {
              const reply = await page.evaluate(() => window.executor.readAccess());
              return reply.ok
                ? reply.data.connections.reduce((total, item) => total + item.sessions, 0)
                : null;
            })
            .toBe(1);
        } finally {
          await second.close();
        }
        await page.getByRole('tab', { name: '连接', exact: true }).click();
        assert.equal((await client.listTools()).tools.length, 16);
        const task = await call(client, 'task_start', {
          cwd: workspace,
          capabilities: ['files.write', 'shell.execute'],
          idempotencyKey: 'desktop-task',
        });
        const saved = await page.evaluate(() =>
          window.executor.saveSettings({ port: 19877, networkAddress: null })
        );
        assert.equal(saved.ok, true);
        assert.equal((await call(client, 'task_status', { taskId: task.taskId })).task.state, 'active');
        await call(client, 'write', {
          taskId: task.taskId,
          path: 'a.txt',
          content: 'one',
          expectedVersion: 'absent',
          idempotencyKey: 'write',
        });
        assert.equal((await call(client, 'read', { taskId: task.taskId, path: 'a.txt' })).text, 'one');
        await call(client, 'edit', {
          taskId: task.taskId,
          path: 'a.txt',
          edits: [{ oldText: 'one', newText: 'two' }],
          idempotencyKey: 'edit',
        });
        assert.equal(
          (await call(client, 'find', { taskId: task.taskId, pattern: '*.txt' })).entries.length,
          1
        );
        assert.equal((await call(client, 'grep', { taskId: task.taskId, pattern: 'two' })).entries.length, 1);
        assert.equal((await call(client, 'ls', { taskId: task.taskId })).entries.length, 1);
        const shell = await call(client, 'powershell', {
          taskId: task.taskId,
          command: "[Console]::Write('desktop')",
          idempotencyKey: 'powershell',
        });
        assert.equal(shell.exitCode, 0);
        await call(client, 'write', {
          taskId: task.taskId,
          path: join(root, 'cross-directory.txt'),
          content: 'device access',
          expectedVersion: 'absent',
          idempotencyKey: 'cross-directory',
        });
        assert.equal(await readFile(join(root, 'cross-directory.txt'), 'utf8'), 'device access');
        const artifact = shell.outputArtifact.uri.slice('executor-output://'.length);
        assert.equal(
          await readFile(
            join(data, 'project', 'shell', '.octopus-executor-recovery-' + artifact, 'stdout'),
            'utf8'
          ),
          'desktop'
        );
        await page.getByRole('button', { name: '本机智能体的授权操作', exact: true }).click();
        await page.getByRole('menuitem', { name: '撤销授权', exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: '撤销授权', exact: true }).click();
        await page.getByText('已撤销', { exact: true }).waitFor();
        await page.getByRole('tab', { name: '状态', exact: true }).click();
        await expect
          .poll(async () => {
            const reply = await page.evaluate(() => window.executor.readAccess());
            return reply.ok ? reply.data.connections.reduce((total, item) => total + item.sessions, 0) : null;
          })
          .toBe(0);
        assert.equal((await fetch(server.url, { headers: server.headers })).status, 401);
        await assert.rejects(client.listTools());
        await assert.rejects(
          readFile(join(data, 'project', 'shell', '.octopus-executor-recovery-' + artifact, 'stdout')),
          { code: 'ENOENT' }
        );
      } finally {
        await client.close();
      }
      assert.equal((await page.evaluate(() => window.executor.readAccess())).data.clients[0].revoked, true);
    });
  }
);

test(
  'approval is independent of download, cancellation preserves authorization and configuration IPC rejects untrusted frames',
  { timeout: 60000 },
  async () => {
    await fixture(async ({ app, page, root, data }) => {
      const output = join(root, 'existing.json');
      await writeFile(output, 'preserve');
      await app.evaluate(({ dialog }) => {
        dialog.showSaveDialog = async () => {
          throw new Error('Creation must not ask to export');
        };
      });
      const input = { label: 'independent', permissions: ['files.read'], waitBudgetMs: 120000 };
      const approval = await page.evaluate((value) => window.executor.approveAccess(value), input);
      assert.equal(approval.ok, true);
      assert.equal(approval.data.clients.length, 1);
      const clientId = approval.data.clients[0].clientId;
      const selection = { clientId, transport: 'http' };
      const persisted = await readFile(join(data, 'project', 'connections', clientId + '.json'), 'utf8');
      assert.ok(JSON.parse(persisted).encrypted);
      const preview = await page.evaluate(
        (value) => window.executor.readClientConfiguration(value),
        selection
      );
      assert.equal(preview.ok, true);
      assert.ok(preview.data.preview.includes('<授权凭据>'));
      assert.equal(/Bearer [a-f0-9]{64}/.test(preview.data.preview), false);
      await app.evaluate(({ clipboard }) => {
        clipboard.writeText = (text) => {
          globalThis.fixtureConfiguration = text;
        };
      });
      assert.equal(
        (await page.evaluate((value) => window.executor.copyClientConfiguration(value), selection)).ok,
        true
      );
      const copied = JSON.parse(await app.evaluate(() => globalThis.fixtureConfiguration));
      const token = Object.values(copied.mcpServers)[0].headers.Authorization.slice(7);
      assert.equal(persisted.includes(token), false);
      assert.equal(
        JSON.stringify(await page.evaluate(() => window.executor.readAccess())).includes(token),
        false
      );
      await selections(app, output, true);
      assert.deepEqual(
        await page.evaluate((value) => window.executor.downloadClientConfiguration(value), selection),
        { ok: true, cancelled: true }
      );
      assert.equal((await page.evaluate(() => window.executor.readAccess())).data.clients[0].revoked, false);
      await selections(app, output);
      const failed = await page.evaluate(
        (value) => window.executor.downloadClientConfiguration(value),
        selection
      );
      assert.equal(failed.ok, false);
      assert.equal(await readFile(output, 'utf8'), 'preserve');
      assert.equal((await page.evaluate(() => window.executor.readAccess())).data.clients[0].revoked, false);
      await assert.rejects(
        page.evaluate((value) => window.executor.approveAccess({ ...value, root: 'C:\\' }), input)
      );
      await assert.rejects(
        page.evaluate(
          (value) => window.executor.copyClientConfiguration({ ...value, text: 'arbitrary' }),
          selection
        )
      );
      await app.evaluate(
        async ({ BrowserWindow }, preload) => {
          const auxiliary = new BrowserWindow({
            show: false,
            webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false },
          });
          await auxiliary.loadURL('app://ui/index.html');
        },
        join(appRoot, 'dist', 'preload', 'index.cjs')
      );
      const auxiliary = app.windows().find((window) => window !== page);
      await auxiliary.waitForFunction(() => Boolean(window.executor));
      assert.equal((await auxiliary.evaluate(() => window.executor.readAccess())).code, 'FORBIDDEN');
      assert.equal(
        (await auxiliary.evaluate((value) => window.executor.copyClientConfiguration(value), selection)).ok,
        false
      );
      await auxiliary.close();
      await page.evaluate((value) => window.executor.revokeAccess({ clientId: value }), clientId);
      assert.equal(
        (await page.evaluate((value) => window.executor.copyClientConfiguration(value), selection)).ok,
        false
      );
    });
  }
);

test(
  'desktop exports a usable private stdio command and its session survives window closure on the same production Runtime',
  { timeout: 60000 },
  async () => {
    await fixture(async ({ app, page, root, workspace }) => {
      const output = join(root, 'stdio 中文 connection.json');
      await selections(app, output);
      await page.getByRole('button', { name: '创建授权', exact: true }).click();
      const inputBounds = await page.getByLabel('授权名称', { exact: true }).boundingBox();
      const submitBounds = await page
        .getByRole('dialog')
        .getByRole('button', { name: '创建授权', exact: true })
        .boundingBox();
      assert.ok(submitBounds && inputBounds);
      assert.equal(Math.round(submitBounds.height), Math.round(inputBounds.height));
      await page.getByRole('dialog').getByRole('button', { name: '创建授权', exact: true }).click();
      await page.locator('[data-slot="toast"]').filter({ hasText: '授权已创建' }).waitFor();
      await downloadCreatedConfiguration(page, 'stdio');
      const config = JSON.parse(await readFile(output, 'utf8'));
      const server = Object.values(config.mcpServers)[0];
      assert.equal(server.command, join(appRoot, 'dist/native/mcp-launcher.exe'));
      assert.deepEqual(server.args.slice(0, 2), ['--mcp-stdio', '--config']);
      assert.notEqual(server.args[2], output);
      const internalConfig = JSON.parse(await readFile(server.args[2], 'utf8'));
      assert.equal('env' in server, false);
      assert.equal('headers' in server, false);
      const token = internalConfig.runtime.headers.Authorization.slice(7);
      assert.equal(
        JSON.stringify(await page.evaluate(() => window.executor.readAccess())).includes(token),
        false
      );
      assert.equal((await page.locator('body').innerText()).includes(token), false);
      const binary = join(appRoot, 'dist/native/file-commit.node');
      assert.equal((await createRequire(binary)(binary).inspect(output)).privateAcl, true);
      const client = new Client({ name: 'desktop stdio acceptance', version: '1' });
      const transport = new StdioClientTransport({ ...server, stderr: 'pipe' });
      let diagnostics = '';
      transport.stderr.on('data', (bytes) => {
        diagnostics = (diagnostics + bytes.toString()).slice(-4096);
      });
      try {
        await client.connect(transport);
        await page.getByRole('tab', { name: '状态', exact: true }).click();
        await expect
          .poll(async () => {
            const reply = await page.evaluate(() => window.executor.readAccess());
            return reply.ok ? reply.data.connections.reduce((total, item) => total + item.sessions, 0) : null;
          })
          .toBe(1);
        const before = (await page.evaluate(() => window.executor.readStatus())).data;
        const task = await call(client, 'task_start', {
          cwd: workspace,
          capabilities: ['files.read'],
          idempotencyKey: 'stdio-ui',
        });
        await writeFile(join(workspace, 'stdio.txt'), 'real stdio');
        assert.equal(
          (await call(client, 'read', { taskId: task.taskId, path: 'stdio.txt' })).text,
          'real stdio'
        );
        await call(client, 'task_end', { taskId: task.taskId });
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
        const closed = page.waitForEvent('close');
        await app.evaluate(({ BrowserWindow }) => {
          BrowserWindow.getAllWindows()[0].destroy();
        });
        await closed;
        assert.ok((await client.listTools()).tools.some((tool) => tool.name === 'read'));
        const recreated = app.waitForEvent('window');
        await app.evaluate(({ app }) => app.emit('activate'));
        const reopened = await recreated;
        await expect
          .poll(async () => {
            const reply = await reopened.evaluate(() => window.executor.readAccess());
            return reply.ok ? reply.data.connections.reduce((total, item) => total + item.sessions, 0) : null;
          })
          .toBe(1);
        assert.equal((await reopened.evaluate(() => window.executor.readStatus())).data.pid, before.pid);
        const pid = transport.pid;
        await app.close();
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
          try {
            process.kill(pid, 0);
          } catch (error) {
            if (error.code === 'ESRCH') {
              break;
            }
            throw error;
          }
          await new Promise((accept) => setTimeout(accept, 50));
        }
        assert.throws(
          () => process.kill(pid, 0),
          (error) => error.code === 'ESRCH'
        );
        assert.equal(diagnostics.includes(token), false);
      } finally {
        await client.close();
      }
    });
  }
);
