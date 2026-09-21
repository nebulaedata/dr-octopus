/**
 * @author Codex
 * @description Validates an installed release outside the repository using isolated data and real process/transport boundaries.
 */
import assert from 'node:assert/strict';
import { execFile, fork } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { readReleaseLayout, insidePath } from '../src/distribution/config.ts';
import { runtimeDirectory } from '../src/distribution/location.ts';

const root = resolve(process.argv[2]);
const layout = readReleaseLayout(join(root, 'release-layout.json'));
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const runtime = runtimeDirectory({ root, layout, packaged: true });
const data = await mkdtemp(join(tmpdir(), 'octopus-release-runtime-'));
const home = join(data, 'home');
const agent = join(home, '.dr-octopus/agent');
await mkdir(agent, { recursive: true });
const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  PI_OFFLINE: 'true',
  NPM_CONFIG_REGISTRY: 'http://127.0.0.1:9',
  npm_config_registry: 'http://127.0.0.1:9',
  DR_OCTOPUS_CODING_AGENT_DIR: agent,
  SERVER_DATA_DIR: join(home, '.dr-octopus/server'),
  SERVER_HOST: '127.0.0.1',
  SERVER_PORT: '31947',
  NODE_ENV: 'production',
  SERVER_FILE_LOG_ENABLED: '',
};
delete env.NODE_OPTIONS;
const exec = promisify(execFile);
const entry = resolve(root, manifest.bin[layout.command]);
const checks = [];

/**
 * Runs only the packaged CLI from an unrelated cwd, preserving clean JSON stdout.
 */
async function cli(...args) {
  const { stdout } = await exec(process.execPath, [entry, ...args, '--json'], {
    cwd: data,
    env,
    timeout: 180_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true, stdout);
  return result.result;
}

const initial = await cli('gateway', 'status');
assert.equal(
  initial.state,
  'stopped',
  'Stop the current OS-user Gateway before running release integration tests.'
);
try {
  const start = await cli('gateway', 'start', '--file-log');
  assert.equal(start.fileLogging.state, 'healthy');
  checks.push('background startup, native SQLite migrations and file-log Worker');
  const origin = start.address;
  for (const path of ['/', '/workspaces/general/sessions/deep-link']) {
    const response = await fetch(origin + path, { headers: { accept: 'text/html' } });
    assert.equal(response.status, 200, path);
    assert.match(await response.text(), /<html/);
  }
  for (const path of ['/api/unknown', '/ws/missing', '/assets/missing.js', '/server/dist/index.js']) {
    assert.equal((await fetch(origin + path, { headers: { accept: 'text/html' } })).status, 404, path);
  }
  checks.push('same-origin pages, SPA deep links, protected paths');
  await cli('gateway', 'health');
  await assert.rejects(
    cli('gateway', 'start'),
    (error) => JSON.parse(error.stdout).error.code === 'GATEWAY_ALREADY_RUNNING'
  );
  await assert.rejects(
    cli('gateway', 'run'),
    (error) => JSON.parse(error.stdout).error.code === 'GATEWAY_ALREADY_RUNNING'
  );
  checks.push('foreground/background singleton exclusion');
  const events = new AbortController();
  const sse = await fetch(origin + '/api/data/events', { signal: events.signal });
  assert.equal(sse.status, 200);
  assert.match(sse.headers.get('content-type'), /text\/event-stream/);
  await sse.body.getReader().read();
  events.abort();
  await new Promise((resolveSocket, reject) => {
    const socket = new WebSocket(origin.replace('http:', 'ws:') + '/ws');
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('WebSocket handshake timed out'));
    }, 5000);
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      socket.close();
      resolveSocket();
    });
    socket.addEventListener('error', reject);
  });
  checks.push('SSE and WebSocket handshake');
  const rpcResult = await exec(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
    const { createWorkspaceService } = await import('@octopus/agent');
    const { AgentRpcProcess } = await import('@octopus/agent/rpc');
    const workspace = (await createWorkspaceService().list())[0];
    const rpc = new AgentRpcProcess({ workspace, agentDir: process.env.DR_OCTOPUS_CODING_AGENT_DIR, requestTimeoutMs: 60000 });
    try { await rpc.start(); console.log(JSON.stringify(await rpc.execute({type:'get_state'}))); }
    finally { await rpc.stop(); }
  `,
    ],
    { cwd: insidePath(runtime, layout.paths.cli), env, timeout: 90000, maxBuffer: 2 * 1024 * 1024 }
  );
  assert.match(rpcResult.stdout, /get_state/);
  checks.push('real packaged Agent RPC get_state, Pi patch and bundled infra');
  const scheduler = await cli('scheduler', 'start');
  assert.equal(scheduler.state, 'control-ready');
  const restarted = await cli('gateway', 'restart');
  assert.notEqual(restarted.instanceId, start.instanceId);
  assert.equal(restarted.fileLogging.enabled, true);
  await cli('gateway', 'stop');
  assert.equal((await cli('scheduler', 'status')).pid, scheduler.pid);
  checks.push('serial restart preserves file logging; Gateway stop preserves Scheduler');
  await cli('gateway', 'stop');
  const logs = await readdir(join(env.SERVER_DATA_DIR, 'logs'));
  const log = logs.find((name) => name.endsWith('.jsonl'));
  assert.ok(log);
  JSON.parse((await readFile(join(env.SERVER_DATA_DIR, 'logs', log), 'utf8')).trim().split('\n')[0]);
  checks.push('JSONL persisted and drained');
  const workerRoot = join(data, 'worker');
  await mkdir(join(workerRoot, 'out'), { recursive: true });
  const source = Buffer.from('Release attachment worker smoke');
  await writeFile(join(workerRoot, 'source.txt'), source);
  await new Promise((resolveWorker, reject) => {
    const child = fork(
      join(
        dirname(insidePath(runtime, layout.paths.serverEntry)),
        'modules/attachments/workers/processor-child.js'
      ),
      [],
      {
        cwd: workerRoot,
        env,
        execArgv: [],
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      }
    );
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Attachment Worker timed out'));
    }, 15000);
    child.on('error', reject);
    child.on('message', (message) => {
      if (message.type === 'error') {
        clearTimeout(timer);
        reject(new Error(JSON.stringify(message)));
      }
      if (message.type === 'result') {
        clearTimeout(timer);
        assert.ok(message.manifest.outputs.length);
        resolveWorker();
      }
    });
    child.send({
      protocol: 1,
      type: 'start',
      jobId: randomUUID(),
      attachmentId: randomUUID(),
      processor: { id: 'attachment-processor', version: '1.0.0' },
      input: {
        relativePath: 'source.txt',
        sha256: createHash('sha256').update(source).digest('hex'),
        detectedMediaType: 'text/plain',
      },
      outputDirectory: 'out',
      limits: {
        wallTimeMs: 10000,
        maxRssBytes: 536870912,
        maxOutputBytes: 1048576,
        maxOutputFiles: 4,
        maxImagePixels: 1,
        maxPages: 1,
        maxExtractedCharacters: 10000,
      },
    });
  });
  checks.push('packaged attachment child produces artifacts');
  console.log(JSON.stringify({ root, runtime, data, checks }, null, 2));
} finally {
  await cli('gateway', 'stop').catch((error) => console.error(error.message));
  await cli('scheduler', 'stop').catch((error) => console.error(error.message));
}
