/**
 * @author Codex
 * @description Verifies Web Host Settings, the installed MCP extension and production RPC Agent against an isolated real Electron Executor.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Fastify from 'fastify';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { createPiMcpStore } from '../../dist/infrastructure/pi-mcp/index.js';
import { McpSettingsService } from '../../dist/modules/mcp-settings/mcp-settings.service.js';
import { registerMcpSettingsController } from '../../dist/modules/mcp-settings/mcp-settings.controller.js';

const executorRoot = resolve(fileURLToPath(new URL('../../../executor/', import.meta.url)));
const executorRequire = createRequire(join(executorRoot, 'package.json'));
let toolCallSequence = 0;

/**
 * Emits one deterministic model tool decision or a terminal response through real provider SSE.
 */
function respond(response, input) {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const delta = input
    ? {
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: 'executor-call-' + ++toolCallSequence,
            type: 'function',
            function: { name: 'mcp', arguments: JSON.stringify(input) },
          },
        ],
      }
    : { role: 'assistant', content: 'Test turn completed.' };
  for (const [value, reason] of [
    [delta, null],
    [{}, input ? 'tool_calls' : 'stop'],
  ]) {
    response.write(
      'data: ' +
        JSON.stringify({
          id: 'executor-test',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'fixture',
          choices: [{ index: 0, delta: value, finish_reason: reason }],
        }) +
        '\n\n'
    );
  }
  response.end('data: [DONE]\n\n');
}

test(
  'Web Host and real Pi MCP extension execute seven Basic tools with desktop approval and revocation',
  { skip: process.platform !== 'win32', timeout: 300000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'octopus-web-executor-'));
    const data = join(root, 'data');
    const workspace = join(root, 'workspace');
    const agentDir = join(root, 'agent');
    await Promise.all([data, workspace, agentDir].map((path) => mkdir(path)));
    const environmentNames = ['DR_OCTOPUS_CODING_AGENT_DIR', 'PI_CODING_AGENT_DIR'];
    const previous = environmentNames.map((name) => process.env[name]);
    for (const name of environmentNames) process.env[name] = agentDir;
    let decision;
    const model = createServer(async (request, response) => {
      for await (const chunk of request) void chunk;
      const input = decision;
      decision = undefined;
      respond(response, input);
    });
    const settingsApi = Fastify();
    let app;
    let session;
    let resourceLoader;
    let executorPage;
    let rpc;
    let stopCoreServices;
    try {
      const { _electron: electron } = executorRequire('@playwright/test');
      app = await electron.launch({
        cwd: executorRoot,
        timeout: 45000,
        args: [executorRoot, '--executor-test', '--executor-test-data=' + data],
      });
      const page = await app.firstWindow();
      executorPage = page;
      page.setDefaultTimeout(45000);
      await page.getByTestId('runtime-state').filter({ hasText: '已启动' }).waitFor();
      await page.getByRole('tab', { name: '连接', exact: true }).click();
      const output = join(root, 'executor.json');
      await app.evaluate(
        ({ dialog }, values) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [values.workspace] });
          dialog.showSaveDialog = async () => ({ canceled: false, filePath: values.output });
        },
        { workspace, output }
      );
      await page.getByRole('checkbox', { name: '写入与编辑文件（包含读取）', exact: true }).check();
      await page.getByRole('checkbox', { name: '运行 PowerShell 命令', exact: true }).check();
      await page.getByRole('button', { name: '授权此设备并导出配置' }).click();
      await page.getByRole('status').filter({ hasText: '私有连接配置已导出' }).waitFor();
      const config = JSON.parse(await readFile(output, 'utf8'));
      const entry = config.mcpServers['octopus-executor'];
      await writeFile(join(agentDir, 'mcp.json'), JSON.stringify(config));
      const store = createPiMcpStore({ agentDir, controlPlaneCwd: workspace });
      registerMcpSettingsController(settingsApi, new McpSettingsService(store));
      const catalog = (await settingsApi.inject('/settings/mcp-servers')).json();
      const server = catalog.servers.find((item) => item.name === 'octopus-executor');
      assert.ok(server);
      assert.equal(catalog.adapter.version, '2.34.0');
      const detail = await settingsApi.inject('/settings/mcp-servers/' + server.serverKey);
      assert.ok(
        !detail.body.includes(entry.headers.Authorization.slice(7)),
        'Web DTO cannot expose the Bearer'
      );
      const probe = (
        await settingsApi.inject({
          method: 'POST',
          url: '/settings/mcp-servers/' + server.serverKey + '/connectivity-probe',
        })
      ).json();
      assert.equal(probe.servers[0].status, 'connected');
      assert.equal(probe.servers[0].toolCount, 12);

      await new Promise((resolve) => model.listen(0, '127.0.0.1', resolve));
      await writeFile(
        join(agentDir, 'models.json'),
        JSON.stringify({
          providers: {
            fixture: {
              api: 'openai-completions',
              apiKey: 'fixture-only',
              baseUrl: `http://127.0.0.1:${model.address().port}/v1`,
              models: [
                {
                  id: 'fixture',
                  name: 'Executor test',
                  reasoning: false,
                  input: ['text'],
                  contextWindow: 32000,
                  maxTokens: 2000,
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                },
              ],
            },
          },
        })
      );
      const modelRuntime = await ModelRuntime.create({
        modelsPath: join(agentDir, 'models.json'),
        authPath: join(agentDir, 'auth.json'),
        modelsStorePath: join(agentDir, 'models-store.json'),
      });
      const settingsManager = SettingsManager.inMemory(
        { autoCompactionEnabled: false, autoRetryEnabled: false },
        { projectTrusted: true }
      );
      resourceLoader = new DefaultResourceLoader({
        cwd: workspace,
        agentDir,
        settingsManager,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        additionalExtensionPaths: [fileURLToPath(import.meta.resolve('pi-mcp-adapter'))],
      });
      await resourceLoader.reload();
      const opened = await createAgentSession({
        cwd: workspace,
        agentDir,
        settingsManager,
        modelRuntime,
        model: modelRuntime.getModel('fixture', 'fixture'),
        resourceLoader,
        sessionManager: SessionManager.inMemory(workspace),
        tools: ['mcp'],
      });
      session = opened.session;
      assert.deepEqual(opened.extensionsResult.errors, []);
      await session.bindExtensions({ mode: 'rpc', uiContext: { setStatus() {}, notify() {} } });

      /**
       * Runs the actual Agent loop and installed MCP gateway, returning its protocol content.
       */
      async function call(tool, args = {}, expectError = false) {
        const count = session.messages.length;
        decision = { server: 'octopus-executor', tool, args };
        await session.prompt('Perform the deterministic MCP verification step.');
        assert.equal(decision, undefined, 'Model endpoint must have been reached');
        const result = session.messages.slice(count).find((message) => message.role === 'toolResult');
        assert.ok(result, 'Agent must actually call its MCP tool');
        assert.equal(result.isError, expectError, JSON.stringify(result.content));
        const text = result.content
          .filter((item) => item.type === 'text')
          .map((item) => item.text)
          .join('\n');
        return expectError ? text : JSON.parse(text);
      }

      const status = await call('runtime_status');
      assert.equal(status.computer.available, false);
      const task = await call('task_start', {
        cwd: workspace,
        capabilities: ['files.write', 'shell.execute'],
        idempotencyKey: 'web-task',
      });
      assert.ok(task.taskId);
      await call('write', {
        taskId: task.taskId,
        path: 'web.txt',
        content: 'one',
        expectedVersion: 'absent',
        idempotencyKey: 'write',
      });
      assert.equal((await call('read', { taskId: task.taskId, path: 'web.txt' })).text, 'one');
      await call('edit', {
        taskId: task.taskId,
        path: 'web.txt',
        edits: [{ oldText: 'one', newText: 'two' }],
        idempotencyKey: 'edit',
      });
      assert.equal((await call('find', { taskId: task.taskId, pattern: '*.txt' })).entries.length, 1);
      assert.equal((await call('grep', { taskId: task.taskId, pattern: 'two' })).entries.length, 1);
      assert.equal((await call('ls', { taskId: task.taskId })).entries.length, 1);
      assert.equal(
        (
          await call('powershell', {
            taskId: task.taskId,
            command: "[Console]::Write('web-agent')",
            idempotencyKey: 'powershell',
          })
        ).exitCode,
        0
      );
      assert.equal(await readFile(join(workspace, 'web.txt'), 'utf8'), 'two');
      await call('task_end', { taskId: task.taskId });
      const beforeClose = await page.evaluate(() => globalThis.window.executor.readStatus());
      const closed = page.waitForEvent('close');
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
      await closed;
      assert.equal((await call('runtime_status')).computer.available, false);
      const recreated = app.waitForEvent('window');
      await app.evaluate(({ app }) => app.emit('activate'));
      const reopened = await recreated;
      executorPage = reopened;
      await reopened.getByTestId('runtime-state').filter({ hasText: '已启动' }).waitFor();
      assert.equal(
        (await reopened.evaluate(() => globalThis.window.executor.readStatus())).data.pid,
        beforeClose.data.pid
      );
      await reopened.getByRole('tab', { name: '连接', exact: true }).click();
      await reopened.getByRole('button', { name: '撤销', exact: true }).click();
      await reopened.getByText('本机智能体 · 已撤销', { exact: true }).waitFor();
      assert.equal((await fetch(entry.url, { headers: entry.headers })).status, 401);
      await call('runtime_status', {}, true);

      await session.abort();
      for (const extension of resourceLoader.getExtensions().extensions) {
        for (const handler of extension.handlers.get('session_shutdown') ?? [])
          await handler({ type: 'session_shutdown', reason: 'shutdown' }, {});
      }
      session.dispose();
      session = undefined;
      resourceLoader = undefined;

      const childEnvironment = { USERPROFILE: root, HOME: root, PI_OFFLINE: '1' };
      const home = await promisify(execFile)(process.execPath, ['-p', 'require("node:os").homedir()'], {
        env: { ...process.env, ...childEnvironment },
        timeout: 10000,
      });
      assert.equal(
        resolve(home.stdout.trim()),
        resolve(root),
        'Production Agent must resolve an isolated user home'
      );
      const { createWorkspaceService, stopMemoryService, stopSchedulerService, stopKnowledgeService } =
        await import('@octopus/agent');
      stopCoreServices = async () => {
        const results = await Promise.allSettled([
          stopMemoryService(join(root, '.dr-octopus'), 10000),
          stopSchedulerService(agentDir),
          stopKnowledgeService(agentDir, 10000),
        ]);
        for (const result of results) assert.equal(result.status, 'fulfilled', result.reason?.message);
      };
      const { AgentRpcProcess } = await import('@octopus/agent/rpc');
      const coreWorkspace = await createWorkspaceService(join(root, '.dr-octopus')).resolve({
        id: 'general',
      });
      const coreOutput = join(root, 'core-executor.json');
      await app.evaluate(
        ({ dialog }, values) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [values.workspace] });
          dialog.showSaveDialog = async () => ({ canceled: false, filePath: values.output });
        },
        { workspace: coreWorkspace.cwd, output: coreOutput }
      );
      await reopened.getByRole('checkbox', { name: '写入与编辑文件（包含读取）', exact: true }).check();
      await reopened.getByRole('checkbox', { name: '运行 PowerShell 命令', exact: true }).check();
      await reopened.getByRole('button', { name: '授权此设备并导出配置' }).click();
      await reopened.getByRole('status').filter({ hasText: '私有连接配置已导出' }).waitFor();
      const coreConfig = JSON.parse(await readFile(coreOutput, 'utf8'));
      await writeFile(join(agentDir, 'mcp.json'), JSON.stringify(coreConfig));
      await writeFile(
        join(agentDir, 'settings.json'),
        JSON.stringify({
          defaultProvider: 'fixture',
          defaultModel: 'fixture',
          packages: [],
          extensions: [fileURLToPath(import.meta.resolve('pi-mcp-adapter'))],
          autoCompactionEnabled: false,
          autoRetryEnabled: false,
        })
      );
      rpc = new AgentRpcProcess({
        workspace: coreWorkspace,
        agentDir,
        childEnvironment,
        requestTimeoutMs: 60000,
        stopTimeoutMs: 5000,
      });
      await rpc.start();

      /**
       * Traverses the production RPC Agent and its permission UI using only controlled fixture decisions.
       */
      async function callRpc(tool, args = {}) {
        let turnTimer;
        const settled = Promise.withResolvers();
        const unsubscribe = rpc.onEvent((event) => {
          if (event.type === 'agent_settled') settled.resolve();
          if (event.type === 'extension_ui_request' && event.method === 'select') {
            if (event.options?.includes('Yes')) {
              void rpc
                .respondToExtensionUi({ type: 'extension_ui_response', id: event.id, value: 'Yes' })
                .catch(settled.reject);
            } else {
              settled.reject(new Error('Unexpected production Agent permission dialog.'));
            }
          }
        });
        try {
          const before = await rpc.execute({ type: 'get_messages' });
          decision = { server: 'octopus-executor', tool, args };
          await rpc.execute({ type: 'prompt', message: 'Perform the deterministic MCP verification step.' });
          await Promise.race([
            settled.promise,
            new Promise((_, reject) => {
              turnTimer = setTimeout(() => reject(new Error('Production Agent turn did not settle.')), 45000);
              turnTimer.unref();
            }),
          ]);
          assert.equal(decision, undefined);
          const after = await rpc.execute({ type: 'get_messages' });
          const result = after.data.messages
            .slice(before.data.messages.length)
            .find((message) => message.role === 'toolResult');
          assert.ok(result, 'Production Agent must execute its actual MCP tool');
          assert.equal(result.isError, false, JSON.stringify(result.content));
          return JSON.parse(
            result.content
              .filter((item) => item.type === 'text')
              .map((item) => item.text)
              .join('\n')
          );
        } finally {
          clearTimeout(turnTimer);
          unsubscribe();
        }
      }

      assert.equal((await callRpc('runtime_status')).computer.available, false);
      const coreTask = await callRpc('task_start', {
        cwd: coreWorkspace.cwd,
        capabilities: ['files.write', 'shell.execute'],
        idempotencyKey: 'core-task',
      });
      await callRpc('write', {
        taskId: coreTask.taskId,
        path: 'core.txt',
        content: 'actual-rpc-agent',
        expectedVersion: 'absent',
        idempotencyKey: 'core-write',
      });
      assert.equal(
        (await callRpc('read', { taskId: coreTask.taskId, path: 'core.txt' })).text,
        'actual-rpc-agent'
      );
      await callRpc('edit', {
        taskId: coreTask.taskId,
        path: 'core.txt',
        edits: [{ oldText: 'actual-rpc-agent', newText: 'actual-rpc-agent-edited' }],
        idempotencyKey: 'core-edit',
      });
      assert.equal((await callRpc('find', { taskId: coreTask.taskId, pattern: '*.txt' })).entries.length, 1);
      assert.equal(
        (await callRpc('grep', { taskId: coreTask.taskId, pattern: 'actual-rpc-agent-edited' })).entries
          .length,
        1
      );
      assert.ok((await callRpc('ls', { taskId: coreTask.taskId })).entries.length >= 1);
      const coreShell = await callRpc('powershell', {
        taskId: coreTask.taskId,
        command: "[Console]::Write('rpc-agent')",
        idempotencyKey: 'core-powershell',
      });
      assert.equal(coreShell.exitCode, 0);
      const artifact = coreShell.outputArtifact.uri.slice('executor-output://'.length);
      assert.equal(
        await readFile(
          join(data, '.octopus-executor-recovery-shell', '.octopus-executor-recovery-' + artifact, 'stdout'),
          'utf8'
        ),
        'rpc-agent'
      );
      assert.equal(await readFile(join(coreWorkspace.cwd, 'core.txt'), 'utf8'), 'actual-rpc-agent-edited');
      await callRpc('task_end', { taskId: coreTask.taskId });
      await rpc.stop();
    } catch (error) {
      console.error(
        'Client verification failure: ' +
          JSON.stringify({
            name: error.name,
            message: error.message,
            code: error.code,
            cause: error.cause?.message,
          })
      );
      if (rpc)
        console.error(
          'Agent RPC diagnostic: ' +
            rpc
              .getStderr()
              .slice(-4096)
              .replace(/[a-f0-9]{64}/gi, '[redacted]')
        );
      if (executorPage)
        console.error(
          'Executor state: ' +
            (await executorPage
              .locator('body')
              .innerText()
              .catch(() => 'Management window closed.'))
        );
      throw error;
    } finally {
      await rpc?.stop();
      await stopCoreServices?.();
      await session?.abort();
      for (const extension of resourceLoader?.getExtensions().extensions ?? []) {
        for (const handler of extension.handlers.get('session_shutdown') ?? [])
          await handler({ type: 'session_shutdown', reason: 'shutdown' }, {});
      }
      session?.dispose();
      await settingsApi.close();
      model.closeAllConnections();
      if (model.listening) await new Promise((resolve) => model.close(resolve));
      await app?.close().catch(() => {});
      for (const [index, name] of environmentNames.entries()) {
        if (previous[index] === undefined) delete process.env[name];
        else process.env[name] = previous[index];
      }
      assert.ok(root.startsWith(join(tmpdir(), 'octopus-web-executor-')));
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
);
