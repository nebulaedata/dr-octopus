/**
 * @author Codex
 * @description Verifies packaged stdio configuration after an installation move and completed file summaries after Runtime restart using isolated data.
 */
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import test from 'node:test';
import { _electron as electron } from '@playwright/test';
import { FuseV1Options, FuseVersion, flipFuses } from '@electron/fuses';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ConnectionSettings } from '../../src/main/connection-settings.ts';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';
import { deviceConnectionKey } from '../../src/contracts/device-identity.ts';

/**
 * Saves an unused loopback port in the fixture's actual private settings before either packaged launch.
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
  const settings = await ConnectionSettings.open(native, join(data, 'project'));
  await settings.save({ port, networkAddress: null });
}

/**
 * Launches the packaged Main, sandboxed Preload and production Runtime with private fixture data and restricted PATH.
 */
async function launch(product, data) {
  const app = await electron.launch({
    executablePath: join(product, 'Dr.Octopus Executor.exe'),
    args: ['--user-data-dir=' + data],
    env: { ...process.env, PATH: join(process.env.SystemRoot, 'System32'), NODE_OPTIONS: '' },
    timeout: 30000,
  });
  try {
    const page = await app.firstWindow();
    await page.getByTestId('runtime-state').filter({ hasText: '已启动' }).waitFor({ timeout: 30000 });
    assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
    return { app, page };
  } catch (error) {
    await app.close();
    throw error;
  }
}

/**
 * Captures only the owned test clipboard; credential decryption, authorization and private config creation remain production code.
 */
async function configuration(app, page, clientId) {
  await app.evaluate(({ clipboard }) => {
    clipboard.writeText = (value) => {
      globalThis.fixtureConfiguration = value;
    };
  });
  const reply = await page.evaluate(
    (value) => window.executor.copyClientConfiguration({ clientId: value, transport: 'stdio' }),
    clientId
  );
  assert.equal(reply.ok, true);
  const text = await app.evaluate(() => globalThis.fixtureConfiguration);
  const access = await page.evaluate(() => window.executor.readAccess());
  assert.equal(access.ok, true);
  return JSON.parse(text).mcpServers[deviceConnectionKey(access.data.device)];
}

/**
 * Rejects tool failures without including configuration credentials in test output.
 */
async function call(client, name, args) {
  const reply = await client.callTool({ name, arguments: args });
  assert.notEqual(reply.isError, true, JSON.stringify(reply));
  return reply.structuredContent.data;
}

test(
  'packaged installation move preserves authorization and retrieves write/edit summaries without replay',
  { timeout: 180000 },
  async () => {
    assert.ok(
      process.env.EXECUTOR_ACCEPTANCE_DIR,
      'Set EXECUTOR_ACCEPTANCE_DIR to the fresh acceptance output.'
    );
    const root = await mkdtemp(join(tmpdir(), 'octopus-packaged-recovery-'));
    let app;
    let client;
    try {
      const original = join(root, 'old installation');
      const moved = join(root, 'new installation');
      const data = join(root, 'data');
      const workspace = join(root, 'workspace');
      await cp(join(process.env.EXECUTOR_ACCEPTANCE_DIR, 'win-unpacked'), original, { recursive: true });
      await mkdir(data);
      await mkdir(workspace);
      // Only the disposable copy exposes the inspector needed by Playwright; the release keeps all Fuses.
      await flipFuses(join(original, 'Dr.Octopus Executor.exe'), {
        version: FuseVersion.V1,
        [FuseV1Options.EnableNodeCliInspectArguments]: true,
      });
      // Substitute the OS registration step in this copy so neither launch migrates the user's real Browser Host.
      await writeFile(
        join(original, 'resources/executor/setup/register-browser-host.ps1'),
        'param($Mode, $ResourceRoot, $ProjectRoot, [switch]$MigrateProduct)\r\nexit 0\r\n'
      );
      // Load the settings writer from the original artifact, keeping its native DLL outside the directory being moved.
      await prepareSettings(join(process.env.EXECUTOR_ACCEPTANCE_DIR, 'win-unpacked'), data);
      let current = await launch(original, data);
      app = current.app;
      const approval = await current.page.evaluate(() =>
        window.executor.approveAccess({
          label: 'packaged recovery',
          permissions: ['files.write'],
          waitBudgetMs: 120000,
        })
      );
      assert.equal(approval.ok, true);
      const clientId = approval.data.clients[0].clientId;
      const first = await configuration(app, current.page, clientId);
      const retainedBytes = await readFile(first.args[2]);
      client = new Client({ name: 'packaged recovery', version: '1' });
      const firstTransport = new StdioClientTransport({ ...first, stderr: 'pipe' });
      firstTransport.stderr.resume();
      await client.connect(firstTransport);
      const task = await call(client, 'task_start', {
        cwd: workspace,
        capabilities: ['files.write'],
        idempotencyKey: 'task',
      });
      const write = {
        taskId: task.taskId,
        path: 'proof.txt',
        content: 'original',
        expectedVersion: 'absent',
        idempotencyKey: 'write',
      };
      const written = await call(client, 'write', write);
      const edit = {
        taskId: task.taskId,
        path: 'proof.txt',
        edits: [{ oldText: 'original', newText: 'edited' }],
        idempotencyKey: 'edit',
      };
      const edited = await call(client, 'edit', edit);
      await call(client, 'task_end', { taskId: task.taskId });
      await client.close();
      client = null;
      await app.close();
      app = null;
      await writeFile(join(workspace, 'proof.txt'), 'externally changed');
      assert.ok(original.startsWith(root + '\\') && moved.startsWith(root + '\\'));
      await rename(original, moved);
      current = await launch(moved, data);
      app = current.app;
      const replacement = await configuration(app, current.page, clientId);
      assert.equal(replacement.command, join(moved, 'resources/executor/native/mcp-launcher.exe'));
      assert.notEqual(replacement.args[2], first.args[2]);
      assert.deepEqual(await readFile(first.args[2]), retainedBytes);
      client = new Client({ name: 'packaged recovery after move', version: '1' });
      const replacementTransport = new StdioClientTransport({ ...replacement, stderr: 'pipe' });
      replacementTransport.stderr.resume();
      await client.connect(replacementTransport);
      for (const [name, input, outcome] of [
        ['write', write, written],
        ['edit', edit, edited],
      ]) {
        assert.deepEqual(await call(client, name, input), {
          retained: true,
          fileEffect: outcome.fileEffect,
          version: outcome.version,
        });
      }
      assert.equal(await readFile(join(workspace, 'proof.txt'), 'utf8'), 'externally changed');
    } finally {
      await client?.close();
      await app?.close();
      assert.ok(root.startsWith(join(tmpdir(), 'octopus-packaged-recovery-')));
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
);
