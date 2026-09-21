/**
 * @author Codex
 * @description Stops real managed processes through a busy Pi RPC session using an isolated local model.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { projectBackgroundTasks } from '@octopus/shared/protocol';
import { stopSession } from '../../dist/lib/runtime/stop-session.js';

/**
 * Waits on observable facts with bounded latency and diagnostics from the isolated runtime.
 */
async function until(predicate, diagnostic) {
  for (let i = 0; i < 600; i++) {
    if (predicate()) return;
    await delay(50);
  }
  throw new Error(diagnostic());
}

test(
  'busy real Pi RPC stops registered process and never mistakes an ACK for completion',
  { timeout: 120000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'octopus-background-rpc-'));
    const agentDir = join(root, 'agent');
    await mkdir(agentDir);
    const node = process.execPath.replaceAll('\\', '/');
    const script = Buffer.from('console.log("owned="+process.pid);setInterval(()=>{},1000)').toString(
      'base64'
    );
    const command = `"${node}" -e "eval(Buffer.from('${script}','base64').toString())"`;
    let requests = 0;
    const schemaErrors = [];
    const http = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const schema = body.tools?.find((tool) => tool.function?.name === 'background_task')?.function
        .parameters;
      if (schema?.type !== 'object' || schema.anyOf || schema.oneOf) {
        schemaErrors.push('background_task requires a top-level object schema');
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: schemaErrors.at(-1), type: 'invalid_request_error' } }));
        return;
      }
      requests++;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.flushHeaders();
      if (requests > 1) return; // Keep the model busy until abort closes this stream.
      const delta = {
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: 'start-one',
            type: 'function',
            function: {
              name: 'background_task',
              arguments: JSON.stringify({ action: 'start', command, label: 'RPC process' }),
            },
          },
        ],
      };
      for (const [value, finish_reason] of [
        [delta, null],
        [{}, 'tool_calls'],
      ]) {
        res.write(
          `data: ${JSON.stringify({ id: 'probe', object: 'chat.completion.chunk', choices: [{ index: 0, delta: value, finish_reason }] })}\n\n`
        );
      }
      res.end('data: [DONE]\n\n');
    });
    await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
    t.after(() => {
      http.closeAllConnections();
      http.close();
    });
    await writeFile(
      join(agentDir, 'models.json'),
      JSON.stringify({
        providers: {
          local: {
            api: 'openai-completions',
            apiKey: 'test',
            baseUrl: `http://127.0.0.1:${http.address().port}/v1`,
            models: [
              {
                id: 'fixture',
                name: 'fixture',
                reasoning: false,
                input: ['text'],
                contextWindow: 32000,
                maxTokens: 1000,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              },
            ],
          },
        },
      })
    );
    await writeFile(
      join(agentDir, 'settings.json'),
      JSON.stringify({ packages: [], retry: { enabled: false }, compaction: { enabled: false } })
    );
    const cli = join(
      dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))),
      'bundle/cli.js'
    );
    const extension = fileURLToPath(
      new URL('../../../../packages/agent/dist/extensions/background-task/index.js', import.meta.url)
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
        join(root, 'session.jsonl'),
        '--model',
        'local/fixture',
      ],
      {
        cwd: root,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          DR_OCTOPUS_CODING_AGENT_DIR: agentDir,
          PI_CODING_AGENT_DIR: agentDir,
          PI_OFFLINE: '1',
        },
      }
    );
    let stderr = '';
    let snapshot;
    const pending = new Map();
    child.stderr.on('data', (data) => {
      stderr += data;
    });
    createInterface({ input: child.stdout }).on('line', (line) => {
      const event = JSON.parse(line);
      if (event.type === 'response') pending.get(event.id)?.(event);
      const observation = projectBackgroundTasks(event);
      if (observation !== undefined) snapshot = observation;
    });
    let serial = 0;
    /**
     * Correlates independent JSONL requests so busy model execution cannot serialize cancellation.
     */
    function execute(command) {
      const id = `background-${++serial}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`RPC timeout: ${stderr}`));
        }, 35000);
        pending.set(id, (response) => {
          clearTimeout(timer);
          pending.delete(id);
          resolve(response);
        });
        child.stdin.write(JSON.stringify({ ...command, id }) + '\n');
      });
    }
    t.after(async () => {
      if (child.exitCode === null) {
        try {
          await stopSession(
            { execute },
            { readFleet: () => undefined, readBackground: () => snapshot, timeoutMs: 5000 }
          );
        } catch {
          /* Native Job closes on parent exit. */
        }
        child.stdin.end();
        await delay(100);
        if (child.exitCode === null) child.kill();
      }
    });
    const catalog = await execute({ type: 'get_commands' });
    assert.ok(
      catalog.data.commands.some((item) => item.name === 'octopus-background'),
      stderr
    );
    await execute({ type: 'prompt', message: 'Start the managed process.' });
    await until(
      () => schemaErrors.length > 0 || (requests > 1 && snapshot?.activeCount === 1),
      () => `${stderr}; ${JSON.stringify(snapshot)}`
    );
    assert.deepEqual(schemaErrors, [], 'actual provider request must carry a compatible function schema');
    const taskId = snapshot.tasks[0].taskId;
    await execute({ type: 'prompt', message: '/octopus-background logs missing-task' });
    assert.ok(snapshot.error, 'handler failures must be observable despite the RPC acknowledgement');
    for (let attempt = 0; attempt < 30; attempt++) {
      await execute({ type: 'prompt', message: `/octopus-background logs ${taskId}` });
      if (/owned=\d+/.test(snapshot.logs.text)) break;
      await delay(50);
    }
    assert.match(snapshot.logs.text, /owned=\d+/);
    assert.equal(snapshot.error, undefined, 'successful log reads must clear the previous control error');
    const pid = Number(snapshot.logs.text.match(/owned=(\d+)/)[1]);
    assert.equal((await execute({ type: 'get_state' })).data.isStreaming, true);
    await stopSession({ execute }, { readFleet: () => undefined, readBackground: () => snapshot });
    assert.equal(snapshot.activeCount, 0);
    assert.equal(snapshot.accepting, true);
    assert.equal(snapshot.tasks[0].state, 'stopped');
    assert.throws(() => process.kill(pid, 0));
  }
);
