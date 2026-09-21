/**
 * @author Codex
 * @description Verifies that memory write contention yields to unrelated Server requests before retrying.
 */
import assert from 'node:assert/strict';
import { stopMemoryService } from '@octopus/agent';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { MemoryService } from '../dist/modules/memory/memory.service.js';
import { registerMemoryController } from '../dist/modules/memory/memory.controller.js';

test('a competing memory writer does not stall unrelated HTTP requests and retry succeeds', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'memory-contention-'));
  const server = Fastify();
  const service = new MemoryService(server, { dataRoot: root });
  let releaseChild = async () => {};
  registerMemoryController(server, service);
  server.get('/health', () => ({ ok: true }));
  t.after(async () => {
    await releaseChild();
    await server.close();
    await stopMemoryService(root);
    await rm(root, { recursive: true, force: true });
  });
  await service.policy({ mode: 'auto', expectedRevision: 0, requestId: 'initialize' });
  const status = await service.status();
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import Database from ${JSON.stringify(import.meta.resolve('better-sqlite3'))};
    const db = new Database(${JSON.stringify(join(root, 'memory', 'memory.db'))});
    db.exec('BEGIN IMMEDIATE');
    process.send('locked');
    process.once('message', () => { db.exec('ROLLBACK'); db.close(); process.disconnect(); });
  `,
    ],
    { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true }
  );
  const exited = new Promise((resolve) => child.once('exit', resolve));
  releaseChild = async () => {
    if (child.connected) {
      child.send('release');
    }
    const timeout = setTimeout(() => child.kill(), 5000);
    try {
      await exited;
    } finally {
      clearTimeout(timeout);
    }
  };
  await new Promise((resolve, reject) => {
    child.once('message', resolve);
    child.once('error', reject);
    child.stderr.once('data', (data) => reject(new Error(String(data))));
  });
  const started = performance.now();
  const writing = server.inject({
    method: 'POST',
    url: '/memory/policy',
    payload: { mode: 'manual', expectedRevision: status.revision, requestId: 'contended-write' },
  });
  // Keep the external write lock until the main thread has handled an unrelated request.
  await new Promise((resolve) => setTimeout(resolve, 150));
  const health = await server.inject('/health');
  const responseDelay = performance.now() - started;
  child.send('release');
  const result = await writing;
  assert.equal(health.statusCode, 200);
  assert.ok(responseDelay < 1000, `Unrelated HTTP response stalled for ${Math.round(responseDelay)}ms`);
  assert.equal(result.statusCode, 200, result.body);
  assert.equal((await service.status()).mode, 'manual');
});
