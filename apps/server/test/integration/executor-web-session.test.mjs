/**
 * @author Codex
 * @description Exercises Basic or Browser HTTP/stdio MCP through the real Web conversation, Server coordinator and production RPC Agent against an isolated Electron Executor.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer as createHttpServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createWebBrowserFixture } from './executor-web-browser.mjs';
import { createWebLongControlFixture } from './executor-web-long-control.mjs';
import { createLossyMcpProxy } from './executor-web-lossy-mcp.mjs';

const executorRoot = resolve(fileURLToPath(new URL('../../../executor/', import.meta.url)));
const webRoot = resolve(fileURLToPath(new URL('../../../web/dist/client/', import.meta.url)));
const requireExecutor = createRequire(join(executorRoot, 'package.json'));
const transport = process.env.EXECUTOR_WEB_TRANSPORT ?? 'http';
assert.ok(['http', 'stdio'].includes(transport), 'Select an implemented MCP transport');
const waitMode = process.env.EXECUTOR_WEB_WAIT_MODE ?? 'short';
assert.ok(
  ['short', 'sdk-default-long', 'configured-long', 'budget-600'].includes(waitMode),
  'Select a finite wait scenario'
);
const budget600 = waitMode === 'budget-600';
let waitSeconds = waitMode === 'short' ? 0 : 65;
if (budget600) waitSeconds = 595;
const clientTimeoutMs = budget600 ? 600000 : 120000;
const scenario = process.env.EXECUTOR_WEB_SCENARIO ?? 'basic';
const browserRecovery = scenario === 'browser' && process.env.EXECUTOR_WEB_BROWSER_CHECK === 'recovery';
const browserInflight = scenario === 'browser' && process.env.EXECUTOR_WEB_BROWSER_CHECK === 'inflight';
const browserDom = scenario === 'browser' && process.env.EXECUTOR_WEB_BROWSER_CHECK === 'dom';
const browserLifecycle = scenario === 'browser' && process.env.EXECUTOR_WEB_BROWSER_CHECK === 'lifecycle';
let testBudget = 300000;
if (budget600) testBudget = 800000;
else if (browserRecovery || browserInflight || browserDom || browserLifecycle) testBudget = 420000;
assert.ok(['basic', 'browser'].includes(scenario), 'Select an implemented Web acceptance scenario');
assert.ok(scenario !== 'browser' || waitMode === 'short', 'Browser actions use the short-call scenario');
const controlMode = process.env.EXECUTOR_WEB_CONTROL ?? 'none';
assert.ok(['none', 'cancel', 'revoke', 'disconnect'].includes(controlMode));
assert.ok(controlMode === 'none' || (scenario === 'basic' && waitMode === 'short'));
assert.ok(controlMode !== 'disconnect' || transport === 'http');

/**
 * Observes only adapter processes whose command line references this fixture's private configuration.
 * @returns Exact process identities without exposing command lines or credentials.
 */
async function readStdioProcesses(config) {
  const { stdout } = await promisify(execFile)(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "@(Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'mcp-launcher.exe' -or $_.Name -eq 'node.exe') -and $_.CommandLine -and $_.CommandLine.Contains($env:EXECUTOR_WEB_PROCESS_CONFIG) } | Select-Object ProcessId,ParentProcessId,Name) | ConvertTo-Json -Compress",
    ],
    { env: { ...process.env, EXECUTOR_WEB_PROCESS_CONFIG: config }, timeout: 10000 }
  );
  const parsed = stdout.trim() ? JSON.parse(stdout) : [];
  return Array.isArray(parsed) ? parsed : [parsed];
}

/**
 * Checks a previously observed PID without signalling or terminating the process.
 * @throws Unexpected process inspection failures.
 */
function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

/**
 * Streams a finite MCP decision through the installed provider's actual SSE protocol.
 */
function respond(response, call, sequence) {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const delta = call
    ? {
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: 'web-session-' + sequence,
            type: 'function',
            function: { name: 'mcp', arguments: JSON.stringify({ server: 'octopus-executor', ...call }) },
          },
        ],
      }
    : { role: 'assistant', content: 'Executor Web session verification complete.' };
  for (const [value, finish_reason] of [
    [delta, null],
    [{}, call ? 'tool_calls' : 'stop'],
  ]) {
    response.write(
      'data: ' +
        JSON.stringify({
          id: 'web-session',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'fixture',
          choices: [{ index: 0, delta: value, finish_reason }],
        }) +
        '\n\n'
    );
  }
  response.end('data: [DONE]\n\n');
}

test(
  `real Web session executes ${scenario} tools through ${transport} MCP, Server scheduling and WebSocket`,
  { skip: process.platform !== 'win32', timeout: testBudget },
  async (testContext) => {
    const root = await mkdtemp(join(tmpdir(), 'octopus-web-session-'));
    const agentDir = join(root, 'agent');
    const data = join(root, 'executor');
    await Promise.all([agentDir, data].map((path) => mkdir(path)));
    const overrides = {
      USERPROFILE: root,
      HOME: root,
      PI_OFFLINE: '1',
      DR_OCTOPUS_CODING_AGENT_DIR: agentDir,
      PI_CODING_AGENT_DIR: agentDir,
    };
    const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
    Object.assign(process.env, overrides);
    assert.equal(resolve(homedir()), resolve(root), 'All Host and Agent paths must use the isolated home');
    const desktopEnvironment = Object.fromEntries(
      Object.entries({ ...process.env, USERPROFILE: previous.USERPROFILE, HOME: previous.HOME }).filter(
        ([, value]) => value !== undefined
      )
    );
    let app;
    let server;
    let browser;
    let webPage;
    let executorPage;
    let stopServices;
    let taskId;
    let executionCwd;
    let runtimePid;
    let exportedConfig;
    let windowClosed = false;
    let windowReopened = false;
    let adapterProcesses = [];
    let adapterExited = false;
    let shellStartedAt;
    let shellElapsedMs;
    let timeoutSavedThroughWeb = false;
    let connectivityProbe;
    let browserFixture;
    let browserSteps;
    let pendingBrowserCall;
    let browserEvidence;
    let controlFixture;
    let controlEvidence;
    const lossyProxy = controlMode === 'disconnect' ? createLossyMcpProxy() : undefined;
    let sequence = 0;
    const results = new Map();
    const errors = [];
    const wsSent = [];
    const wsReceived = [];
    let approvals = 0;
    const cleanupErrors = [];
    const model = createHttpServer(async (request, response) => {
      try {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString());
        assert.ok(body.tools.some((tool) => tool.function?.name === 'mcp'));
        for (const message of body.messages.filter((item) => item.role === 'tool')) {
          if (results.has(message.tool_call_id)) continue;
          let result;
          try {
            result = JSON.parse(message.content);
          } catch {
            if (
              (controlMode !== 'none' && message.tool_call_id === 'web-session-9') ||
              pendingBrowserCall?.expectedAdapterError
            ) {
              result = {
                adapterError: String(message.content)
                  .replace(/[a-f0-9]{64}/g, '[redacted]')
                  .slice(0, 512),
              };
            } else if (pendingBrowserCall?.expectedError && String(message.content).startsWith('Error: {')) {
              // The installed adapter projects MCP isError replies as a prefixed JSON error plus schema help.
              const firstLine = String(message.content).split('\n')[0];
              result = { error: JSON.parse(firstLine.slice('Error: '.length)) };
            } else {
              throw new Error(
                `MCP returned text for ${message.tool_call_id}: ${String(message.content)
                  .replace(/[a-f0-9]{64}/g, '[redacted]')
                  .slice(0, 512)}`
              );
            }
          }
          if (pendingBrowserCall?.expectedError) {
            assert.equal(result.error?.code, pendingBrowserCall.expectedError);
          } else if (
            !pendingBrowserCall?.expectedAdapterError &&
            (controlMode === 'none' || message.tool_call_id !== 'web-session-9')
          ) {
            assert.ok(!result.error, 'Executor must return successful tool content');
          }
          results.set(message.tool_call_id, result);
          if (result.taskId) taskId = result.taskId;
          if (scenario === 'basic' && message.tool_call_id === 'web-session-9')
            shellElapsedMs = Date.now() - shellStartedAt;
        }
        if ((transport === 'stdio' || scenario === 'browser') && sequence === 2) {
          if (transport === 'stdio') {
            adapterProcesses = await readStdioProcesses(exportedConfig);
            assert.equal(
              adapterProcesses.length,
              2,
              'One launcher and one private Node must own the adapter'
            );
            const launcher = adapterProcesses.find((item) => item.Name === 'mcp-launcher.exe');
            const node = adapterProcesses.find((item) => item.Name === 'node.exe');
            assert.ok(launcher && node);
            assert.equal(node.ParentProcessId, launcher.ProcessId);
          }
          if (controlMode === 'none' && !browserInflight) {
            await executorPage.getByRole('tab', { name: '状态', exact: true }).click();
            await executorPage.getByTestId('connection-count').filter({ hasText: /^1$/ }).waitFor();
            assert.equal((await executorPage.evaluate(() => globalThis.executor.minimize())).ok, true);
            const closed = executorPage.waitForEvent('close');
            await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
            await closed;
            windowClosed = true;
          }
        }
        let command = "[Console]::Write('web-session-shell')";
        if (waitSeconds)
          command = `Start-Sleep -Seconds ${waitSeconds}; [Console]::Write('web-session-shell')`;
        if (budget600)
          command =
            "[IO.File]::AppendAllText([IO.Path]::Combine($PWD.Path, 'web-budget-started.txt'), 'start'); [Console]::Write('web-budget-start'); Start-Sleep -Seconds 595; [Console]::Write('web-session-shell')";
        if (controlFixture) command = controlFixture.command;
        const steps = [
          { tool: 'runtime_status', args: {} },
          {
            tool: 'task_start',
            args: {
              cwd: executionCwd,
              capabilities: ['files.write', 'shell.execute'],
              idempotencyKey: 'web-session-task',
            },
          },
          {
            tool: 'write',
            args: {
              taskId,
              path: 'web-session.txt',
              content: 'web-session-original',
              expectedVersion: 'absent',
              idempotencyKey: 'web-session-write',
            },
          },
          { tool: 'read', args: { taskId, path: 'web-session.txt' } },
          {
            tool: 'edit',
            args: {
              taskId,
              path: 'web-session.txt',
              edits: [{ oldText: 'web-session-original', newText: 'web-session-edited' }],
              idempotencyKey: 'web-session-edit',
            },
          },
          { tool: 'find', args: { taskId, pattern: 'web-session.txt' } },
          { tool: 'grep', args: { taskId, pattern: 'web-session-edited', glob: 'web-session.txt' } },
          { tool: 'ls', args: { taskId } },
          {
            tool: 'powershell',
            args: {
              taskId,
              command,
              ...(waitSeconds || controlFixture ? { timeout: budget600 ? 600 : 90 } : {}),
              idempotencyKey: 'web-session-powershell',
            },
          },
          ...(budget600
            ? [{ tool: 'task_status', args: { taskId, operationKey: 'web-session-powershell' } }]
            : []),
          { tool: 'task_end', args: { taskId } },
        ];
        let call = steps[sequence];
        if (controlFixture && sequence >= 9) {
          call = undefined;
          if (controlMode === 'disconnect') {
            if (sequence === 9) {
              assert.ok(results.get('web-session-9').adapterError, 'The client must observe a lost reply');
              await controlFixture.waitForCompletion(taskId);
              call = { tool: 'task_status', args: { taskId, operationKey: 'web-session-powershell' } };
            } else if (sequence === 10) {
              assert.equal(results.get('web-session-10').operation.state, 'completed');
              call = steps[8];
            } else if (sequence === 11) {
              assert.equal(results.get('web-session-11').terminationReason, 'completed');
              call = { tool: 'task_end', args: { taskId } };
            }
          }
        }
        if (browserSteps) {
          const next = await browserSteps.next(results.get('web-session-' + sequence));
          pendingBrowserCall = next.value;
          call = next.done ? undefined : { tool: next.value.tool, args: next.value.args };
        }
        if (call?.tool === 'powershell') shellStartedAt = Date.now();
        respond(response, call, ++sequence);
      } catch (error) {
        errors.push(error.message);
        // Finish only this deterministic model turn; the harness still fails on the original assertion.
        // Returning 500 here tests provider retries instead of the rejected Browser assertion and can outlive teardown.
        respond(response, undefined, ++sequence);
      }
    });
    try {
      await new Promise((resolve) => model.listen(0, '127.0.0.1', resolve));
      const core = await import('@octopus/agent');
      stopServices = async () => {
        const stopped = await Promise.allSettled([
          core.stopMemoryService(join(root, '.dr-octopus'), 10000),
          core.stopSchedulerService(agentDir),
          core.stopKnowledgeService(agentDir, 10000),
        ]);
        for (const result of stopped) assert.equal(result.status, 'fulfilled', result.reason?.message);
      };
      const workspace = await core.createWorkspaceService().resolve({ id: 'general' });
      executionCwd = workspace.cwd;
      assert.ok(resolve(workspace.cwd).startsWith(root));
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
                  name: 'Executor session test',
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
      await writeFile(
        join(agentDir, 'settings.json'),
        JSON.stringify({
          defaultProvider: 'fixture',
          defaultModel: 'fixture',
          packages: [],
          extensions: [fileURLToPath(import.meta.resolve('pi-mcp-adapter'))],
          compaction: { enabled: false },
          retry: { enabled: false },
        })
      );
      const { _electron, chromium, expect } = requireExecutor('@playwright/test');
      if (controlMode !== 'none')
        controlFixture = createWebLongControlFixture({
          mode: controlMode,
          workspace: workspace.cwd,
          data,
          expect,
          proxy: lossyProxy,
        });
      app = await _electron.launch({
        cwd: executorRoot,
        timeout: 45000,
        env: desktopEnvironment,
        args: [executorRoot, '--executor-test', '--executor-test-data=' + data],
      });
      executorPage = await app.firstWindow();
      executorPage.setDefaultTimeout(45000);
      await executorPage.getByTestId('runtime-state').filter({ hasText: '已启动' }).waitFor();
      await executorPage.getByRole('tab', { name: '连接', exact: true }).click();
      runtimePid = (await executorPage.evaluate(() => globalThis.executor.readStatus())).data.pid;
      console.log(JSON.stringify({ stage: 'executor-ready', scenario, transport }));
      if (scenario === 'browser') {
        browserFixture = createWebBrowserFixture({
          root,
          data,
          executorRoot,
          environment: desktopEnvironment,
          chromium,
          expect,
        });
        await browserFixture.start(executorPage);
        console.log(JSON.stringify({ stage: 'browser-connected', browserRecovery }));
        browserSteps = browserFixture.steps();
      }
      const output = join(root, transport === 'stdio' ? 'executor stdio 中文.json' : 'executor.json');
      exportedConfig = output;
      await app.evaluate(
        ({ dialog }, input) => {
          dialog.showOpenDialog = async () => {
            throw new Error('Device approval requested a directory');
          };
          dialog.showSaveDialog = async () => ({ canceled: false, filePath: input.output });
        },
        { output }
      );
      if (scenario === 'browser') {
        await executorPage.getByRole('checkbox', { name: '读取与搜索文件', exact: true }).uncheck();
        await executorPage.getByRole('checkbox', { name: '控制已连接浏览器的网站页面', exact: true }).check();
      } else {
        await executorPage.getByRole('checkbox', { name: '写入与编辑文件（包含读取）', exact: true }).check();
        await executorPage.getByRole('checkbox', { name: '运行 PowerShell 命令', exact: true }).check();
      }
      if (transport === 'stdio')
        await executorPage.getByRole('button', { name: 'stdio', exact: true }).click();
      if (budget600) {
        await executorPage.locator('#wait-budget').click();
        await executorPage.getByRole('option', { name: '600 秒', exact: true }).click();
      }
      await executorPage.getByRole('button', { name: '授权此设备并导出配置' }).click();
      await executorPage.getByRole('status').filter({ hasText: '私有连接配置已导出' }).waitFor();
      if (transport === 'stdio') {
        const config = JSON.parse(await readFile(output, 'utf8'));
        const definition = config.mcpServers['octopus-executor'];
        assert.equal(definition.command, join(executorRoot, 'dist/native/mcp-launcher.exe'));
        assert.deepEqual(definition.args, ['--mcp-stdio', '--config', output]);
        assert.equal('env' in definition, false);
        assert.equal('headers' in definition, false);
      }
      const clientConfig = JSON.parse(await readFile(output, 'utf8'));
      if (lossyProxy)
        clientConfig.mcpServers['octopus-executor'].url = await lossyProxy.start(
          clientConfig.mcpServers['octopus-executor'].url
        );
      await writeFile(join(agentDir, 'mcp.json'), JSON.stringify(clientConfig));
      const { createServer } = await import('../../dist/app.js');
      const { loadServerConfig } = await import('../../dist/infrastructure/config/config.js');
      server = createServer({
        config: loadServerConfig({
          ...overrides,
          SERVER_DATA_DIR: join(root, 'server'),
          SERVER_WEB_ROOT: webRoot,
          NODE_ENV: 'production',
          LOG_LEVEL: 'silent',
          SERVER_FILE_LOG_ENABLED: 'false',
        }),
      });
      const originalWarn = server.log.warn.bind(server.log);
      // Observe the production workflow diagnostic without touching service instances or RPC commands.
      server.log.warn = function (metadata, ...args) {
        if (args[0] === 'Conversation first-message workflow failed') {
          console.error(JSON.stringify({ stage: 'host-preparation-failure', ...metadata }));
        }
        return originalWarn(metadata, ...args);
      };
      await server.listen({ host: '127.0.0.1', port: 0 });
      const origin = `http://127.0.0.1:${server.server.address().port}`;
      assert.equal((await fetch(origin + '/api/workspaces')).status, 200);
      browser = await chromium.launch({
        headless: true,
        channel: process.env.EXECUTOR_WEB_BROWSER_CHANNEL ?? 'chrome',
        env: desktopEnvironment,
      });
      webPage = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 1000 } });
      webPage.setDefaultTimeout(45000);
      webPage.on('websocket', (socket) => {
        socket.on('framesent', ({ payload }) => wsSent.push(JSON.parse(String(payload))));
        socket.on('framereceived', ({ payload }) => wsReceived.push(JSON.parse(String(payload))));
      });
      if (waitMode === 'configured-long' || budget600) {
        await webPage.goto(origin + '/settings/mcp');
        await webPage.getByRole('button').filter({ hasText: 'octopus-executor' }).click();
        const timeout = webPage.getByRole('spinbutton', { name: 'requestTimeoutMs', exact: true });
        await expect(timeout).toHaveValue('');
        await timeout.fill(String(clientTimeoutMs));
        const saved = webPage.waitForResponse(
          (response) =>
            response.request().method() === 'PUT' &&
            new URL(response.url()).pathname.startsWith('/api/settings/mcp-servers/'),
          { timeout: 45000 }
        );
        const probed = webPage.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname.startsWith('/api/settings/mcp-servers/') &&
            new URL(response.url()).pathname.endsWith('/connectivity-probe'),
          { timeout: 45000 }
        );
        await webPage.getByRole('button', { name: 'Save changes', exact: true }).click();
        assert.equal((await saved).status(), 200);
        const probeResponse = await probed;
        assert.equal(probeResponse.status(), 200);
        const probe = await probeResponse.json();
        connectivityProbe = probe.servers[0];
        assert.equal(connectivityProbe.status, 'connected');
        assert.ok(connectivityProbe.toolCount > 0);
        await expect(timeout).toHaveValue(String(clientTimeoutMs));
        await expect(webPage.getByRole('img', { name: 'Connected', exact: true })).toBeVisible();
        const persisted = JSON.parse(await readFile(join(agentDir, 'mcp.json'), 'utf8'));
        assert.equal(persisted.mcpServers['octopus-executor'].requestTimeoutMs, clientTimeoutMs);
        assert.deepEqual(
          JSON.parse(await readFile(output, 'utf8')),
          clientConfig,
          'The private export stays unchanged'
        );
        timeoutSavedThroughWeb = true;
        if (process.env.EXECUTOR_WEB_EVIDENCE_DIR) {
          await mkdir(process.env.EXECUTOR_WEB_EVIDENCE_DIR, { recursive: true });
          await timeout.scrollIntoViewIfNeeded();
          await webPage.screenshot({
            path: join(process.env.EXECUTOR_WEB_EVIDENCE_DIR, `web-timeout-${transport}.png`),
            fullPage: true,
          });
        }
      }
      await webPage.goto(origin + '/workspaces/general');
      const editor = webPage.getByRole('textbox', { name: 'Message Dr.Octopus' });
      await expect(editor).toBeEditable();
      await editor.fill('Verify the Executor through this real Web conversation.');
      await editor.press('Enter');
      await expect(webPage).toHaveURL(/\/sessions\//, { timeout: 60000 });
      console.log(JSON.stringify({ stage: 'web-session-opened' }));
      let runBudget = 120000;
      if (budget600) runBudget = 650000;
      else if (browserRecovery || browserInflight || browserDom || browserLifecycle) runBudget = 300000;
      const deadline = Date.now() + runBudget;
      while (
        !(await webPage.getByText('Executor Web session verification complete.', { exact: true }).isVisible())
      ) {
        testContext.signal.throwIfAborted();
        assert.deepEqual(errors, []);
        if (
          await webPage.getByText('Conversation preparation did not complete.', { exact: false }).isVisible()
        ) {
          throw new Error('Web conversation preparation failed before tool dispatch');
        }
        if (Date.now() > deadline)
          throw new Error(
            'Web turn deadline; body: ' + (await webPage.locator('body').innerText()).slice(-5000)
          );
        const yes = webPage
          .locator('[data-slot="questionnaire-choice"]')
          .filter({ has: webPage.getByText('Yes', { exact: true }) })
          .locator('[data-slot="questionnaire-choice-input"]');
        if (await yes.isVisible()) {
          await yes.click();
          approvals++;
        }
        if (controlFixture) {
          await controlFixture.observe(webPage, executorPage);
          if (controlMode === 'cancel' && controlFixture.wasInterrupted()) {
            controlEvidence = await controlFixture.verify(taskId, webPage);
            break;
          }
        }
        await browserFixture?.observe(webPage, executorPage);
        if (browserFixture?.cancelled()) break;
        await delay(150);
      }
      // A terminal model response can arrive between the loop condition and its
      // next iteration. Report fixture failures before reading success evidence.
      assert.deepEqual(errors, [], 'The controlled model fixture must complete without verification errors');
      if (controlFixture) {
        controlEvidence ??= await controlFixture.verify(taskId, webPage);
        const expectedResults = { cancel: 8, revoke: 9, disconnect: 12 }[controlMode];
        assert.equal(sequence, expectedResults + 1);
        assert.equal(results.size, expectedResults);
        if (controlMode === 'cancel') assert.ok(wsSent.some((event) => event.type === 'agent.abort'));
      } else if (!browserFixture?.cancelled())
        assert.equal(sequence, results.size + 1, 'Every tool call must have one result before completion');
      if (browserInflight) {
        await browserFixture.verifyInflight();
        if (browserFixture.cancelled()) assert.ok(wsSent.some((event) => event.type === 'agent.abort'));
      }
      assert.ok(approvals > 0, 'Permission must be approved through the actual Web questionnaire');
      const ordered = [...results.values()];
      assert.equal(ordered[0].computer.available, false);
      if (scenario === 'basic' && !controlFixture) {
        assert.equal(sequence, budget600 ? 12 : 11, 'Basic tool calls and one terminal response');
        assert.equal(results.size, budget600 ? 11 : 10);
        assert.equal(ordered[3].text, 'web-session-original');
        assert.ok(ordered[5].entries.some((entry) => entry.path === 'web-session.txt'));
        assert.ok(ordered[6].entries.length > 0);
        if (budget600) {
          assert.equal(ordered[8].terminationReason, 'timeout');
          assert.equal(ordered[9].operation.effectiveTimeout, 590);
          assert.equal(ordered[9].operation.state, 'completed');
          assert.ok(shellElapsedMs >= 590000 && shellElapsedMs < 620000);
          assert.equal(await readFile(join(workspace.cwd, 'web-budget-started.txt'), 'utf8'), 'start');
        } else assert.equal(ordered[8].exitCode, 0);
        if (waitSeconds && !budget600)
          assert.ok(shellElapsedMs >= waitSeconds * 1000, 'The actual client must wait beyond 60 seconds');
        assert.equal(await readFile(join(workspace.cwd, 'web-session.txt'), 'utf8'), 'web-session-edited');
        const artifact = ordered[8].outputArtifact.uri.slice('executor-output://'.length);
        assert.equal(
          await readFile(
            join(
              data,
              '.octopus-executor-recovery-shell',
              '.octopus-executor-recovery-' + artifact,
              'stdout'
            ),
            'utf8'
          ),
          budget600 ? 'web-budget-start' : 'web-session-shell'
        );
      }
      assert.ok(wsSent.some((event) => event.type === 'extension.ui.response'));
      assert.ok(wsReceived.some((event) => event.type === 'agent.event'));
      const sessionUrl = webPage.url();
      await webPage.reload();
      if ((!controlFixture || controlMode !== 'cancel') && !browserFixture?.cancelled())
        await expect(
          webPage.getByText('Executor Web session verification complete.', { exact: true })
        ).toBeVisible();
      assert.equal(webPage.url(), sessionUrl);
      if (!browserFixture?.cancelled())
        assert.equal(sequence, results.size + 1, 'Reload must not replay accepted tool actions');
      if (controlFixture) await controlFixture.verify(taskId, webPage);
      if (process.env.EXECUTOR_WEB_EVIDENCE_DIR) {
        await mkdir(process.env.EXECUTOR_WEB_EVIDENCE_DIR, { recursive: true });
        await webPage.screenshot({
          path: join(
            process.env.EXECUTOR_WEB_EVIDENCE_DIR,
            `web-session-${scenario}-${transport}-${waitMode}${controlFixture ? '-' + controlMode : ''}${browserRecovery ? '-recovery' : ''}${browserInflight ? '-inflight-' + (process.env.EXECUTOR_WEB_BROWSER_FAULT ?? 'timeout') : ''}${browserDom ? '-dom' : ''}${browserLifecycle ? '-lifecycle' : ''}.png`
          ),
          fullPage: true,
        });
      }
      if (transport === 'stdio' || scenario === 'browser') {
        if (controlMode === 'none' && !browserInflight) {
          assert.equal(windowClosed, true, 'Tools must finish while the Executor window is closed');
          const recreated = app.waitForEvent('window', { timeout: 45000 });
          await app.evaluate(({ app }) => app.emit('activate'));
          executorPage = await recreated;
          await executorPage.getByTestId('connection-count').filter({ hasText: /^1$/ }).waitFor();
          assert.equal(
            (await executorPage.evaluate(() => globalThis.executor.readStatus())).data.pid,
            runtimePid
          );
          windowReopened = true;
        }
        await app.close();
        app = undefined;
        if (browserFixture) browserEvidence = await browserFixture.verifyExit();
        if (transport === 'stdio') {
          await expect
            .poll(() => adapterProcesses.filter((item) => isProcessRunning(item.ProcessId)).length, {
              timeout: 10000,
              message: 'Runtime exit must also end the actual Agent-owned stdio launcher and private Node',
            })
            .toBe(0);
          assert.deepEqual(
            await readStdioProcesses(exportedConfig),
            [],
            'Runtime exit must not respawn the adapter'
          );
          adapterExited = true;
        }
      }
      console.log(
        JSON.stringify({
          client: 'apps/web',
          browser: browser.version(),
          transport,
          waitMode,
          ...(budget600 ? { clientTimeoutMs, effectiveTimeoutSeconds: 590 } : {}),
          shellElapsedMs,
          timeoutSavedThroughWeb,
          connectivityProbe,
          scenario,
          basicTools: scenario === 'basic' ? 7 : 0,
          browserEvidence,
          controlEvidence,
          toolResults: results.size,
          approvals,
          reloadReplayed: false,
          computerAvailable: false,
          windowClosed,
          windowReopened,
          adapterProcesses,
          adapterExited,
        })
      );
    } catch (error) {
      console.error('Primary verification failure: ' + error.message);
      console.error(JSON.stringify({ modelRequests: sequence, toolResults: results.size, approvals }));
      if (executorPage)
        console.error(
          'Executor state: ' +
            (
              await executorPage
                .locator('body')
                .innerText()
                .catch(() => 'closed')
            ).slice(-5000)
        );
      if (webPage)
        console.error(
          'Web state: ' +
            (
              await webPage
                .locator('body')
                .innerText()
                .catch(() => 'closed')
            ).slice(-5000)
        );
      throw error;
    } finally {
      // A failed deterministic plan must stop accepting model retries before waiting for Agent/Server shutdown.
      // Otherwise its 500 responses can keep an owned Agent active while fixture teardown waits on that Agent.
      model.closeAllConnections();
      if (model.listening) await new Promise((resolve) => model.close(resolve));
      for (const cleanup of [
        () => browser?.close(),
        () => browserFixture?.close(),
        () => lossyProxy?.close(),
        () => server?.close(),
        () => stopServices?.(),
      ]) {
        try {
          await cleanup();
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      await app?.close().catch(() => {});
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      assert.ok(root.startsWith(join(tmpdir(), 'octopus-web-session-')));
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      for (const error of cleanupErrors) console.error('Cleanup failure: ' + error.message);
    }
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Fixture cleanup failed');
  }
);
