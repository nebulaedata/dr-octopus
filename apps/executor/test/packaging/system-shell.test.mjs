/**
 * @author Codex
 * @description Verifies packaged PowerShell and the seven Basic tools through HTTP and stdio with system-only PATH, isolated data and no real Browser Host registration.
 */
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { _electron as electron } from '@playwright/test';
import { FuseV1Options, FuseVersion, flipFuses } from '@electron/fuses';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ConnectionSettings } from '../../src/main/connection-settings.ts';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';
import { createServer } from 'node:net';
import { executorProduct } from '../../src/contracts/product.ts';

/**
 * Uses a fresh loopback port in actual private settings before the packaged Runtime starts.
 */
async function prepareSettings(product, data) {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close((error) => (error ? reject(error) : resolve())));
  const native = new NativeFileCommit(join(product, 'resources/executor/native/file-commit.node'));
  await (await ConnectionSettings.open(native, join(data, 'project'))).save({ port, networkAddress: null });
}

/**
 * Reads configuration only from the test-owned Main clipboard boundary without logging credentials.
 */
async function configuration(app, page, clientId, transport) {
  const reply = await page.evaluate(
    ({ clientId, transport }) => window.executor.copyClientConfiguration({ clientId, transport }),
    { clientId, transport }
  );
  assert.equal(reply.ok, true);
  const text = await app.evaluate(() => globalThis.shellTestClipboard);
  return Object.values(JSON.parse(text).mcpServers)[0];
}

/**
 * Requires actual MCP success and returns only its structured data to assertions.
 */
async function call(client, name, args) {
  const reply = await client.callTool({ name, arguments: args });
  assert.notEqual(reply.isError, true, JSON.stringify(reply));
  return reply.structuredContent.data;
}

test(
  'packaged system PowerShell and independent Basic tools work through HTTP and stdio without PortableGit',
  { timeout: 180000 },
  async () => {
    assert.ok(process.env.EXECUTOR_ACCEPTANCE_DIR, 'Set EXECUTOR_ACCEPTANCE_DIR to fresh package output.');
    const product = join(resolve(process.env.EXECUTOR_ACCEPTANCE_DIR), 'win-unpacked');
    const root = await mkdtemp(join(tmpdir(), 'octopus-packaged-shell-'));
    const clients = [];
    let app;
    try {
      const clone = join(root, '中文 application');
      const data = join(root, 'data');
      const workspace = join(root, 'workspace');
      await cp(product, clone, { recursive: true });
      await mkdir(data);
      await mkdir(workspace);
      // Only this disposable copy enables Playwright and replaces OS registration; release bytes remain untouched.
      await flipFuses(join(clone, 'Dr.Octopus Executor.exe'), {
        version: FuseVersion.V1,
        [FuseV1Options.EnableNodeCliInspectArguments]: true,
      });
      await writeFile(
        join(clone, 'resources/executor/setup/register-browser-host.ps1'),
        'param($Mode, $ResourceRoot, $ProjectRoot, [switch]$MigrateProduct)\r\nexit 0\r\n'
      );
      await prepareSettings(product, data);
      const env = {
        ...process.env,
        PATH: join(process.env.SystemRoot, 'System32'),
        NODE_OPTIONS: '',
        NODE_PATH: '',
      };
      delete env.ELECTRON_RUN_AS_NODE;
      app = await electron.launch({
        executablePath: join(clone, 'Dr.Octopus Executor.exe'),
        args: ['--user-data-dir=' + data],
        env,
        timeout: 30000,
      });
      const page = await app.firstWindow();
      await page.getByTestId('runtime-state').filter({ hasText: '已启动' }).waitFor({ timeout: 30000 });
      assert.equal(await page.title(), `${executorProduct.name} v${executorProduct.version}`);
      assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
      await app.evaluate(({ clipboard }) => {
        clipboard.writeText = (text) => {
          globalThis.shellTestClipboard = text;
        };
      });
      const approval = await page.evaluate(() =>
        window.executor.approveAccess({
          label: 'packaged system Shell',
          permissions: ['files.write', 'shell.execute'],
          waitBudgetMs: 120000,
        })
      );
      assert.equal(approval.ok, true);
      const clientId = approval.data.clients[0].clientId;
      const http = await configuration(app, page, clientId, 'http');
      const client = new Client({ name: 'packaged Shell HTTP', version: '1' });
      clients.push(client);
      await client.connect(
        new StreamableHTTPClientTransport(new URL(http.url), { requestInit: { headers: http.headers } })
      );
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      for (const name of ['read', 'write', 'edit', 'powershell', 'find', 'grep', 'ls']) {
        assert.ok(names.includes(name));
      }
      assert.ok(!names.includes('bash'));
      const status = await call(client, 'runtime_status', {});
      assert.equal(status.shell.available, true);
      assert.equal(status.shell.kind, 'powershell');
      assert.match(status.shell.version, /^5\.1\./);
      const task = await call(client, 'task_start', {
        cwd: workspace,
        capabilities: ['files.write', 'shell.execute'],
        idempotencyKey: 'http',
      });
      await call(client, 'write', {
        taskId: task.taskId,
        path: 'proof.txt',
        content: 'original 中文',
        expectedVersion: 'absent',
        idempotencyKey: 'write',
      });
      await call(client, 'read', { taskId: task.taskId, path: 'proof.txt' });
      await call(client, 'edit', {
        taskId: task.taskId,
        path: 'proof.txt',
        edits: [{ oldText: 'original', newText: 'updated' }],
        idempotencyKey: 'edit',
      });
      assert.equal((await call(client, 'find', { taskId: task.taskId, pattern: '*.txt' })).entries.length, 1);
      assert.equal(
        (await call(client, 'grep', { taskId: task.taskId, pattern: 'updated', literal: true })).entries
          .length,
        1
      );
      assert.equal((await call(client, 'ls', { taskId: task.taskId })).entries.length, 1);
      const command =
        "[Console]::Write('系统 PowerShell 中文;'); node --version; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npm.cmd --version; exit $LASTEXITCODE";
      const outcome = await call(client, 'powershell', {
        taskId: task.taskId,
        command,
        idempotencyKey: 'shell',
      });
      assert.equal(outcome.exitCode, 0, outcome.output);
      assert.match(outcome.output, /系统 PowerShell 中文;/);
      assert.match(outcome.output, /v24\.20\.0/);
      assert.match(outcome.output, /11\.19\.0/);
      await call(client, 'task_end', { taskId: task.taskId });
      const stdio = await configuration(app, page, clientId, 'stdio');
      const second = new Client({ name: 'packaged Shell stdio', version: '1' });
      clients.push(second);
      const transport = new StdioClientTransport({ ...stdio, stderr: 'pipe', env });
      transport.stderr.resume();
      await second.connect(transport);
      assert.equal((await call(second, 'runtime_status', {})).shell.version, status.shell.version);
      const next = await call(second, 'task_start', {
        cwd: workspace,
        capabilities: ['shell.execute'],
        idempotencyKey: 'stdio',
      });
      assert.equal(
        (
          await call(second, 'powershell', {
            taskId: next.taskId,
            command: "[Console]::Write('stdio 中文')",
            idempotencyKey: 'shell',
          })
        ).output,
        'stdio 中文'
      );
      await call(second, 'task_end', { taskId: next.taskId });
      assert.equal(await readFile(join(workspace, 'proof.txt'), 'utf8'), 'updated 中文');
    } finally {
      for (const client of clients.reverse()) {
        await client.close();
      }
      await app?.close();
      assert.ok(resolve(root).startsWith(resolve(tmpdir(), 'octopus-packaged-shell-')));
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
);
