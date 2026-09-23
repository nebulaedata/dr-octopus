/**
 * @author Codex
 * @description Verifies cancellation against a real Pi RPC process and real detached child processes with a local model.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { mkdtemp, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { stopSession } from '../../dist/infrastructure/runtime/stop-session.js';
import { projectSubagentFleetPayload } from '../../dist/infrastructure/runtime/subagent-fleet-projection.js';
import { isCancellationMessage } from '@octopus/shared/utils';

/**
 * Waits for observable runtime evidence with a fixed deadline.
 */
async function until(predicate, label, timeout = 45_000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await delay(50);
  }
}

/**
 * Reads child PIDs from the OS so terminal UI state alone cannot satisfy the cancellation test.
 */
function childProcessIds(pid) {
  const output =
    process.platform === 'win32'
      ? execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            `Get-CimInstance Win32_Process -Filter "ParentProcessId = ${pid}" | Where-Object { $_.Name -eq 'node.exe' -and ($_.CommandLine -like '*--mode json*' -or $_.CommandLine -like '*runner-peer-preload*' -or $_.CommandLine -like '*subagent-runner*') } | Select-Object -ExpandProperty ProcessId`,
          ],
          { windowsHide: true, encoding: 'utf8' }
        )
      : execFileSync('ps', ['-o', 'pid=', '--ppid', String(pid)], { encoding: 'utf8' });
  return output
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((value) => value > 0);
}

/**
 * Captures the live runner command lines so model-start failures remain diagnosable after cleanup.
 */
function runnerProcessDetails(pid) {
  if (process.platform !== 'win32') return 'see ps output on POSIX';
  return execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "ParentProcessId = ${pid}" | Where-Object { $_.Name -eq 'node.exe' } | ForEach-Object { $_.ProcessId.ToString() + ' :: ' + $_.CommandLine } | Out-String`,
    ],
    { windowsHide: true, encoding: 'utf8' }
  ).trim();
}

/**
 * Checks process existence without sending a terminating signal.
 */
function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

test(
  'real RPC abort cancels wait and separately stops both detached children',
  { timeout: 120_000 },
  async (t) => {
    const extension =
      process.env.PI_SUBAGENTS_TEST_PATH ??
      join(homedir(), '.dr-octopus/agent/npm/node_modules/pi-subagents/index.ts');
    // Fail explicitly if the pinned external package is absent; this integration is an opt-in command.
    await readFile(extension);
    const root = await mkdtemp(join(tmpdir(), 'octopus-stop-real-'));
    t.diagnostic(`Isolated evidence directory: ${root}`);
    const agentDir = join(root, 'agent');
    await mkdir(agentDir);
    // pi-subagents ≥0.65 derives its async run directory from a process-lifetime temp scope
    // (tmpdir()/pi-subagents-<scope>), so the runner only writes runner.*.log there when the
    // parent test process opts into a scoped root. Point it at the evidence directory.
    const subagentTempRoot = join(root, 'pi-subagents');
    await mkdir(subagentTempRoot);
    let childRequests = 0;
    let activeChildren = 0;
    let parentRequests = 0;
    const http = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (body.model === 'child') {
        childRequests++;
        activeChildren++;
        res.write(': waiting\n\n');
        res.on('close', () => {
          activeChildren--;
        });
        return;
      }
      parentRequests++;
      // ≥0.65 stop notifications wake the agent loop with a custom `subagent-notify`
      // message, which legitimately triggers another model request after cancellation.
      // Answer those wake turns with plain text so the loop can settle instead of
      // re-entering bg_wait forever.
      if (parentRequests >= 3) {
        res.write(
          `data: ${JSON.stringify({ id: 'probe', object: 'chat.completion.chunk', model: 'parent', choices: [{ index: 0, delta: { role: 'assistant', content: 'Workflow stopped.' }, finish_reason: null }] })}\n\n`
        );
        res.write(
          `data: ${JSON.stringify({ id: 'probe', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`
        );
        res.end('data: [DONE]\n\n');
        return;
      }
      const call =
        parentRequests === 1
          ? {
              name: 'subagent',
              arguments: JSON.stringify({
                async: true,
                workflowScript:
                  'return await runs.all([{key:"left",agent:"delegate",model:"probe/child",task:"Wait for local test output"},{key:"right",agent:"delegate",model:"probe/child",task:"Wait for local test output"}]);',
              }),
            }
          : { name: 'bg_wait', arguments: '{"timeoutMs":60000}' };
      const delta = {
        role: 'assistant',
        tool_calls: [{ index: 0, id: `probe-${parentRequests}`, type: 'function', function: call }],
      };
      res.write(
        `data: ${JSON.stringify({ id: 'probe', object: 'chat.completion.chunk', model: 'parent', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`
      );
      res.write(
        `data: ${JSON.stringify({ id: 'probe', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\n`
      );
      res.end('data: [DONE]\n\n');
    });
    await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
    t.after(() => {
      http.closeAllConnections();
      http.close();
    });
    const models = ['parent', 'child'].map((id) => ({
      id,
      name: id,
      reasoning: false,
      input: ['text'],
      contextWindow: 32000,
      maxTokens: 1000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }));
    await writeFile(
      join(agentDir, 'models.json'),
      JSON.stringify({
        providers: {
          probe: {
            api: 'openai-completions',
            apiKey: 'local-only',
            baseUrl: `http://127.0.0.1:${http.address().port}/v1`,
            models,
          },
        },
      })
    );
    await writeFile(
      join(agentDir, 'settings.json'),
      JSON.stringify({
        defaultProvider: 'probe',
        defaultModel: 'parent',
        retry: { enabled: false },
        compaction: { enabled: false },
        packages: [],
      })
    );
    const cli = join(
      dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))),
      'bundle/cli.js'
    );
    const child = spawn(
      process.execPath,
      [
        cli,
        '--mode',
        'rpc',
        '--no-extensions',
        '--no-skills',
        '-e',
        extension,
        '--session',
        join(root, 'parent.jsonl'),
        '--model',
        'probe/parent',
      ],
      {
        cwd: root,
        windowsHide: true,
        env: {
          ...process.env,
          DR_OCTOPUS_CODING_AGENT_DIR: agentDir,
          // pi-subagents ≥0.65 detached runners resolve the agent directory through the
          // upstream PI_CODING_AGENT_DIR name; without it the runner child sessions read
          // ~/.dr-octopus/agent instead of this isolated directory.
          PI_CODING_AGENT_DIR: agentDir,
          PI_OFFLINE: '1',
          PI_SUBAGENTS_TEMP_ROOT: subagentTempRoot,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    t.after(() => {
      if (process.platform === 'win32' && child.exitCode === null) {
        execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
          windowsHide: true,
          stdio: 'ignore',
        });
      } else child.kill();
    });
    let stderr = '';
    child.stderr.on('data', (data) => {
      stderr += data;
    });
    const pending = new Map();
    let serial = 0;
    let fleet;
    let waiting = false;
    let cancelledMessage;
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      appendFileSync(join(root, 'rpc.jsonl'), `${line}\n`);
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event.type === 'response') pending.get(event.id)?.(event);
      const projection = projectSubagentFleetPayload(event);
      if (projection.kind === 'snapshot') fleet = projection.snapshot;
      if (event.type === 'tool_execution_start' && event.toolName === 'bg_wait') waiting = true;
      // Stop notifications wake the loop into a fresh turn, so the aborted assistant
      // message is no longer the final one; remember the cancellation evidence itself.
      if (
        event.type === 'message_end' &&
        event.message.role === 'assistant' &&
        cancelledMessage === undefined &&
        isCancellationMessage(event.message)
      ) {
        cancelledMessage = event.message;
      }
    });
    /**
     * Uses the actual JSONL transport, retaining independent requests so stop can interrupt an active prompt.
     */
    async function execute(command) {
      const id = `probe-${++serial}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`RPC timed out: ${command.type}; ${stderr.slice(-1500)}`));
        }, 35_000);
        pending.set(id, (response) => {
          clearTimeout(timer);
          pending.delete(id);
          resolve(response);
        });
        child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
      });
    }
    const catalog = await execute({ type: 'get_commands' });
    assert.ok(
      catalog.data.commands.some((command) => command.name === 'subagents-stop'),
      stderr
    );
    const started = await execute({ type: 'prompt', message: 'Launch two probes and wait for them.' });
    assert.equal(started.success, true, JSON.stringify(started));
    await until(
      () => childRequests === 2 && fleet?.runs.some((run) => run.state === 'running'),
      'real children running',
      20_000
    ).catch((error) => {
      throw new Error(
        `${error.message}; children=${childRequests}; fleet=${JSON.stringify(fleet)}; runners=${runnerProcessDetails(child.pid)}; ${stderr.slice(-1500)}`
      );
    });
    await until(() => waiting, 'parent entered bg_wait');
    const pids = childProcessIds(child.pid);
    // pi-subagents ≥0.65 spawns one detached runner OS process per async child; both runs
    // must be observable as OS processes before stopping (two runs.all children → two runners).
    assert.equal(pids.length, 2, 'both detached runner processes must exist before stopping');
    const result = await stopSession({ execute }, { readFleet: () => fleet, timeoutMs: 25_000 });
    assert.equal(result.success, true);
    await until(() => activeChildren === 0, 'child model connections closed', 10_000);
    await until(
      () => pids.every((pid) => !processExists(pid)),
      'both detached runner processes exited',
      10_000
    );
    assert.ok(
      parentRequests <= 4,
      `cancellation may only add stop-notification wake turns, got ${parentRequests} parent requests`
    );
    assert.ok(isCancellationMessage(cancelledMessage), JSON.stringify(cancelledMessage));
    // The terminal fleet snapshot is published from the parent's watch of runner exit
    // proofs, which can land a tick after the OS processes are gone.
    await until(
      () => fleet?.runs.every((run) => run.state !== 'running' && run.state !== 'queued'),
      'fleet snapshot settles to terminal states',
      10_000
    );
  }
);
