/**
 * @author Codex
 * @description Real singleton lifecycle, offline stop suppression, alias discovery and independent CLI coverage.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { AgentRpcProcess } from '../dist/rpc/index.js';
import {
  getSchedulerServiceStatus,
  restartSchedulerService,
  startSchedulerService,
  stopSchedulerService,
} from '../dist/extensions/scheduler/sdk/lifecycle.js';

/**
 * Allocate a profile and stop the exact service through its authenticated control contract before cleanup.
 */
async function profile(t) {
  const root = await mkdtemp(join(tmpdir(), 'octopus-lifecycle-'));
  const directory = join(root, 'agent');
  await mkdir(directory);
  t.after(async () => {
    await stopSchedulerService(directory);
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });
  return directory;
}

test('status is read-only and offline stop suppresses ensure until explicit start', async (t) => {
  const root = await profile(t);
  const directory = join(root, '不存在');
  assert.deepEqual(await getSchedulerServiceStatus(directory), { state: 'absent' });
  await assert.rejects(stat(directory), { code: 'ENOENT' });
  assert.deepEqual(await stopSchedulerService(directory), { state: 'stopped' });
  await assert.rejects(startSchedulerService(directory, false), { code: 'SCHEDULER_STOPPED' });
  const started = await startSchedulerService(directory);
  try {
    assert.equal(started.state, 'control-ready');
    assert.equal(started.executionReady, true);
    assert.deepEqual(await stopSchedulerService(directory), { state: 'stopped' });
    assert.deepEqual(await getSchedulerServiceStatus(directory), { state: 'stopped' });
  } finally {
    await stopSchedulerService(directory);
  }
});

test('concurrent starts and canonical aliases share one daemon; restart transfers ownership', async (t) => {
  const directory = await profile(t);
  const started = await Promise.all(Array.from({ length: 3 }, () => startSchedulerService(directory)));
  assert.ok(started.every((status) => status.daemonId === started[0].daemonId));
  const alias = await getSchedulerServiceStatus(join(directory, '..', directory.split(/[\\/]/).at(-1)));
  assert.equal(alias.daemonId, started[0].daemonId);
  const restarted = await restartSchedulerService(directory);
  assert.notEqual(restarted.daemonId, started[0].daemonId);
  assert.equal(restarted.profileId, started[0].profileId);
  const endpoint = JSON.parse(await readFile(join(directory, '..', 'scheduler', 'endpoint.json'), 'utf8'));
  await assert.rejects(stat(join(directory, 'scheduler')), { code: 'ENOENT' });
  const denied = await fetch(`http://127.0.0.1:${endpoint.port}/scheduler/v1/service/stop`, {
    method: 'POST',
  });
  assert.equal(denied.status, 403);
  assert.equal((await getSchedulerServiceStatus(directory)).daemonId, restarted.daemonId);
});

test('built service CLI works without Workspace, model, onboarding or Server', async (t) => {
  const directory = await profile(t);
  const cli = new URL('../dist/bin/octopus.js', import.meta.url);
  const run = promisify(execFile);
  const started = await run(process.execPath, [
    cli.pathname.replace(/^\/(\w:)/, '$1'),
    'scheduler',
    'service',
    'start',
    '--agent-dir',
    directory,
  ]);
  assert.equal(JSON.parse(started.stdout).state, 'control-ready');
  assert.equal((await getSchedulerServiceStatus(directory)).state, 'control-ready');
  const stopped = await run(process.execPath, [
    cli.pathname.replace(/^\/(\w:)/, '$1'),
    'scheduler',
    'service',
    'stop',
    '--agent-dir',
    directory,
  ]);
  assert.equal(JSON.parse(stopped.stdout).state, 'stopped');
});

test('daemon survives normal RPC Runtime retirement and unexpected Runtime exit', async (t) => {
  const directory = await profile(t);
  const options = {
    workspace: { id: 'fixture', cwd: directory },
    entryPath: fileURLToPath(new URL('./fixtures/scheduler-lifecycle-rpc.mjs', import.meta.url)),
    requestTimeoutMs: 15000,
  };
  for (const crash of [false, true]) {
    const runtime = new AgentRpcProcess(options);
    try {
      await runtime.start();
      const response = await runtime.request({ type: 'test_start_scheduler', agentDir: directory });
      assert.equal(response.success, true);
      if (crash) {
        await assert.rejects(runtime.request({ type: 'test_crash' }));
      } else {
        await runtime.stop();
      }
      assert.equal((await getSchedulerServiceStatus(directory)).daemonId, response.data.daemonId);
    } finally {
      await runtime.stop();
    }
    await stopSchedulerService(directory);
  }
});

test('source CLI starts the built daemon from a different working directory', async (t) => {
  const directory = await profile(t);
  const cli = fileURLToPath(new URL('../src/bin/octopus.ts', import.meta.url));
  const run = promisify(execFile);
  const args = ['--import', import.meta.resolve('tsx'), cli, 'scheduler', 'service'];
  const started = await run(process.execPath, [...args, 'start', '--agent-dir', directory], {
    cwd: directory,
    timeout: 30000,
    windowsHide: true,
  });
  const status = JSON.parse(started.stdout);
  assert.equal(status.state, 'control-ready');
  assert.equal(status.executionReady, true);
  assert.equal((await getSchedulerServiceStatus(directory)).daemonId, status.daemonId);
  const stopped = await run(process.execPath, [...args, 'stop', '--agent-dir', directory], {
    cwd: directory,
    timeout: 30000,
    windowsHide: true,
  });
  assert.equal(JSON.parse(stopped.stdout).state, 'stopped');
});

test('restart upgrades a protocol 2 endpoint while profile and unknown versions remain fenced', async (t) => {
  const directory = await profile(t);
  const started = await startSchedulerService(directory);
  const path = join(directory, '..', 'scheduler', 'endpoint.json');
  const endpoint = JSON.parse(await readFile(path, 'utf8'));
  try {
    await writeFile(path, JSON.stringify({ ...endpoint, protocol: 2, profileId: 'foreign-profile' }));
    await assert.rejects(stopSchedulerService(directory), { code: 'SCHEDULER_PROFILE_MISMATCH' });
    await writeFile(path, JSON.stringify({ ...endpoint, protocol: 999 }));
    await assert.rejects(stopSchedulerService(directory), { code: 'SCHEDULER_VERSION_CONFLICT' });
    await writeFile(path, JSON.stringify({ ...endpoint, protocol: 2 }));
    await assert.rejects(getSchedulerServiceStatus(directory), { code: 'SCHEDULER_VERSION_CONFLICT' });
    const restarted = await restartSchedulerService(directory);
    assert.equal(restarted.protocol, 3);
    assert.equal(restarted.profileId, started.profileId);
    assert.notEqual(restarted.daemonId, started.daemonId);
  } finally {
    // Restore only the original owner's metadata if the test failed before replacement.
    const current = JSON.parse(await readFile(path, 'utf8').catch(() => 'null'));
    if (current?.daemonId === endpoint.daemonId) await writeFile(path, JSON.stringify(endpoint));
  }
});
