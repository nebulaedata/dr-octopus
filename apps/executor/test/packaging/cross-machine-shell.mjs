/**
 * @author Codex
 * @description Exercises the real remote PowerShell MCP tool with isolated files, exact exits, timeout recovery and replay checks without exposing authorization credentials.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { networkInterfaces, hostname } from 'node:os';
import { join, resolve, win32 } from 'node:path';
import { parseArgs } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/**
 * Quotes one literal PowerShell value independently from command syntax.
 */
function literal(value) {
  return "'" + value.replaceAll("'", "''") + "'";
}

/**
 * Tests only the explicitly selected remote device and task-owned files, preserving a non-secret result report.
 */
async function main() {
  const { values } = parseArgs({
    options: {
      config: { type: 'string' },
      'remote-directory': { type: 'string' },
      'output-directory': { type: 'string' },
      'expected-host': { type: 'string' },
      'expected-device-id': { type: 'string' },
    },
  });
  assert.ok(
    values.config &&
      values['remote-directory'] &&
      values['output-directory'] &&
      values['expected-host'] &&
      values['expected-device-id']
  );
  assert.ok(win32.isAbsolute(values['remote-directory']));
  const output = resolve(values['output-directory']);
  await mkdir(output);
  const report = {
    schemaVersion: 1,
    sourceComputer: hostname(),
    startedAt: new Date().toISOString(),
    passed: false,
    cases: [],
    taskEnded: false,
    sessionClosed: false,
  };
  let phase = 'configuration';
  let client;
  let taskId;
  /**
   * Calls the actual MCP service without replaying errors or printing configuration/HTTP diagnostics.
   */
  const call = async (name, args) => {
    phase = name;
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true, 'Remote tool refused: ' + name);
    return result.structuredContent.data;
  };
  /**
   * Checks exact Shell results while keeping tool completion distinct from command success.
   */
  const execute = async (key, command, expectedExit, timeout = 15, expectedReason = 'completed') => {
    const result = await call('powershell', { taskId, command, timeout, idempotencyKey: key });
    assert.equal(result.exitCode, expectedExit, key + ' exit');
    assert.equal(result.terminationReason, expectedReason, key + ' reason');
    assert.equal(result.executionState, 'quiescent', key + ' quiescence');
    report.cases.push({
      name: key,
      exitCode: result.exitCode,
      terminationReason: result.terminationReason,
      executionState: result.executionState,
      durationMs: result.durationMs,
      output: result.output,
      stdoutBytes: result.outputArtifact.stdoutBytes,
      stderrBytes: result.outputArtifact.stderrBytes,
    });
    return result;
  };
  try {
    const info = await open(values.config, 'r');
    let config;
    try {
      assert.ok((await info.stat()).size <= 65536);
      config = JSON.parse((await info.readFile('utf8')).replace(/^\ufeff/, ''));
    } finally {
      await info.close();
    }
    const servers = Object.values(config.mcpServers ?? {});
    assert.equal(servers.length, 1);
    const server = servers[0];
    const endpoint = new URL(server.url);
    assert.equal(endpoint.hostname, values['expected-host']);
    assert.ok(
      endpoint.protocol === 'http:' &&
        endpoint.pathname === '/mcp' &&
        !endpoint.search &&
        !endpoint.hash &&
        !endpoint.username &&
        !endpoint.password
    );
    assert.match(server.headers?.Authorization ?? '', /^Bearer [a-f0-9]{64}$/);
    assert.ok(
      !Object.values(networkInterfaces())
        .flat()
        .some((item) => item?.address === endpoint.hostname)
    );
    client = new Client({ name: 'remote-PowerShell-acceptance', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(endpoint, {
        requestInit: { headers: server.headers },
        fetch: (input, init) => fetch(input, { ...init, redirect: 'error' }),
      })
    );
    const status = await call('runtime_status', {});
    assert.equal(status.device.deviceId, values['expected-device-id']);
    assert.equal(status.device.deviceName, 'LAPTOP-LH');
    assert.ok(status.capabilities.includes('shell.execute'));
    assert.equal(status.shell.available, true);
    assert.equal(status.shell.kind, 'powershell');
    const catalog = (await client.listTools()).tools;
    assert.ok(catalog.some((tool) => tool.name === 'powershell'));
    assert.ok(!catalog.some((tool) => tool.name === 'bash'));
    report.device = status.device;
    report.shell = status.shell;
    report.endpoint = endpoint.href;
    const task = await call('task_start', {
      cwd: values['remote-directory'],
      capabilities: ['shell.execute', 'files.read'],
      idempotencyKey: 'remote-shell-' + randomUUID(),
    });
    taskId = task.taskId;
    report.taskId = taskId;
    const identity = await execute(
      'identity',
      '[Console]::Write(([pscustomobject]@{computer=[Environment]::MachineName;version=$PSVersionTable.PSVersion.ToString();cwd=$PWD.Path;executable=[Diagnostics.Process]::GetCurrentProcess().MainModule.FileName;is64Bit=[Environment]::Is64BitProcess}|ConvertTo-Json -Compress))',
      0
    );
    const actual = JSON.parse(identity.output);
    assert.equal(actual.computer, 'LAPTOP-LH');
    assert.equal(actual.version, status.shell.version);
    assert.equal(actual.cwd, values['remote-directory']);
    assert.ok(actual.is64Bit);
    assert.match(actual.executable, /\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/i);
    report.actualProcess = actual;
    const directory = win32.join(values['remote-directory'], 'PowerShell 验收-' + randomUUID());
    const textPath = win32.join(directory, '中文 空格.txt');
    const counterPath = win32.join(directory, '只执行一次.txt');
    const expectedText = '第一行 中文\r\n第二行😀';
    const command = [
      `$directory = ${literal(directory)}`,
      'New-Item -ItemType Directory -Path $directory -ErrorAction Stop | Out-Null',
      `[IO.File]::WriteAllText(${literal(textPath)}, "第一行 中文\`r\`n第二行😀", [Text.UTF8Encoding]::new($false))`,
      `[IO.File]::AppendAllText(${literal(counterPath)}, 'x', [Text.UTF8Encoding]::new($false))`,
      `$text = [string](Get-Content -LiteralPath ${literal(textPath)} -Raw -Encoding UTF8)`,
      "$pipeline = (@('alpha','beta','gamma') | ForEach-Object { $_.ToUpperInvariant() }) -join '|'",
      '[Console]::Write(([pscustomobject]@{text=$text;pipeline=$pipeline}|ConvertTo-Json -Compress))',
    ].join('\r\n');
    const written = await execute('unicode-file-and-pipeline', command, 0);
    assert.deepEqual(JSON.parse(written.output), { text: expectedText, pipeline: 'ALPHA|BETA|GAMMA' });
    const repeated = await call('powershell', {
      taskId,
      command,
      timeout: 15,
      idempotencyKey: 'unicode-file-and-pipeline',
    });
    assert.deepEqual(repeated, written);
    assert.equal((await call('read', { taskId, path: textPath })).text, expectedText);
    assert.equal((await call('read', { taskId, path: counterPath })).text, 'x');
    report.files = {
      directory,
      textPath,
      counterPath,
      utf8VerifiedByIndependentRead: true,
      replayDidNotRepeatMutation: true,
    };
    const quote = await execute(
      'literal-quoting',
      '[Console]::Write(\'中文 "quoted" \\ path `literal $dollar\')',
      0
    );
    assert.equal(quote.output, '中文 "quoted" \\ path `literal $dollar');
    await execute('explicit-exit', 'exit 7', 7);
    await execute('native-exit', "& $env:ComSpec /d /c 'exit 23'; exit $LASTEXITCODE", 23);
    const nonTerminating = await execute(
      'non-terminating-error',
      "Write-Error '预期的非终止错误'; [Console]::Write('继续执行')",
      0
    );
    assert.ok(nonTerminating.outputArtifact.stderrBytes > 0);
    assert.match(nonTerminating.output, /继续执行/);
    const timed = await call('powershell', {
      taskId,
      command: 'Start-Sleep -Seconds 20',
      timeout: 1,
      idempotencyKey: 'timeout',
    });
    assert.equal(timed.terminationReason, 'timeout');
    assert.equal(timed.executionState, 'quiescent');
    report.cases.push({
      name: 'timeout',
      terminationReason: timed.terminationReason,
      executionState: timed.executionState,
      durationMs: timed.durationMs,
      effectiveTimeoutMs: timed.effectiveTimeoutMs,
    });
    const after = await execute('after-timeout', "[Console]::Write('超时后仍可执行')", 0);
    assert.equal(after.output, '超时后仍可执行');
    await call('task_end', { taskId });
    report.taskEnded = true;
    report.passed = true;
  } catch (error) {
    report.failure = {
      phase,
      type: error?.name,
      code: error?.code ?? null,
      frames: String(error?.stack ?? '')
        .split('\n')
        .filter((line) => /^\s+at /.test(line))
        .slice(0, 3),
    };
    process.exitCode = 1;
  } finally {
    if (taskId && !report.taskEnded) {
      report.cleanupTaskStopped = Boolean(await call('task_stop', { taskId }).catch(() => null));
    }
    if (client) {
      try {
        await client.close();
        report.sessionClosed = true;
      } catch {
        report.passed = false;
        process.exitCode = 1;
      }
    }
    report.completedAt = new Date().toISOString();
    const file = await open(join(output, 'report.json'), 'wx');
    try {
      await file.writeFile(JSON.stringify(report, null, 2));
      await file.sync();
    } finally {
      await file.close();
    }
    console.info(
      JSON.stringify({
        passed: report.passed,
        cases: report.cases.map((item) => ({
          name: item.name,
          exitCode: item.exitCode,
          terminationReason: item.terminationReason,
        })),
        report: join(output, 'report.json'),
        failure: report.failure,
      })
    );
  }
}

await main().catch(() => {
  console.error('Remote PowerShell test could not initialize; credentials were not printed.');
  process.exitCode = 1;
});
