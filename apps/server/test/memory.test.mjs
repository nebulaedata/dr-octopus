/**
 * @author Codex
 * @description Exercise global HTTP management and versioned RPC status projection without Workspace or runtime creation.
 */
import assert from 'node:assert/strict';
import { stopMemoryService } from '@octopus/agent';
import test from 'node:test';
import Fastify from 'fastify';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryService } from '../dist/modules/memory/memory.service.js';
import { registerMemoryController } from '../dist/modules/memory/memory.controller.js';
import { projectMemoryState } from '../dist/infrastructure/runtime/memory-state-projection.js';
import { RuntimeEventProjection } from '../dist/infrastructure/runtime/event-projection.js';
test('HTTP reads are lazy and explicit writes use the same global store with optimistic concurrency', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'memory-http-'));
  const server = Fastify();
  const service = new MemoryService({ dataRoot: root });
  server.addHook('onClose', () => service.close());
  server.register(async (api) => registerMemoryController(api, service), {
    prefix: '/api',
  });
  t.after(async () => {
    await server.close();
    await stopMemoryService(root);
    await rm(root, { recursive: true, force: true });
  });
  const status = await server.inject('/api/memory/status');
  assert.equal(status.statusCode, 200);
  assert.equal(status.json().availability, 'uninitialized');
  await assert.rejects(access(join(root, 'memory')));
  const payload = {
    requestId: 'create',
    canonicalKey: 'http.fact',
    topic: '用户偏好',
    type: 'preference',
    indexText: '使用中文',
    bodyMd: '始终用中文回答',
    action: 'create',
    sources: [],
  };
  const created = await server.inject({ url: '/api/memory/remember', method: 'POST', payload });
  assert.equal(created.statusCode, 200, created.body);
  assert.deepEqual(
    (await server.inject({ url: '/api/memory/remember', method: 'POST', payload })).json(),
    created.json()
  );
  assert.equal((await server.inject('/api/memory/indexes')).json().items.length, 1);
  const ref = created.json().ref;
  const doc = (
    await server.inject({ url: '/api/memory/read', method: 'POST', payload: { refs: [ref] } })
  ).json().items[0].document;
  assert.equal(doc.bodyMd, payload.bodyMd);
  const exported = await server.inject('/api/memory/export');
  assert.equal(exported.statusCode, 200);
  assert.ok(exported.body.includes(payload.bodyMd));
  assert.equal((await server.inject({ url: '/api/memory/rebuild', method: 'POST' })).statusCode, 200);
  assert.equal(
    (
      await server.inject({
        url: '/api/memory/forget',
        method: 'POST',
        payload: { requestId: 'forget-stale', ref, expectedRevision: 99 },
      })
    ).statusCode,
    409
  );
  assert.equal(
    (
      await server.inject({
        url: '/api/memory/remember',
        method: 'POST',
        payload: { ...payload, requestId: 'invalid', workspaceId: 'x' },
      })
    ).statusCode,
    400
  );
  assert.equal(
    (
      await server.inject({
        url: '/api/memory/forget',
        method: 'POST',
        payload: { requestId: 'forget', ref, expectedRevision: doc.revision },
      })
    ).statusCode,
    200
  );
  assert.equal((await server.inject('/api/memory/status')).json().count, 0);
  const currentService = (await server.inject('/api/memory/service/status')).json();
  assert.equal(currentService.state, 'running');
  const restarted = await server.inject({ url: '/api/memory/service/restart', method: 'POST' });
  assert.equal(restarted.statusCode, 200, restarted.body);
  assert.notEqual(restarted.json().daemonId, currentService.daemonId);
  const stopped = await server.inject({ url: '/api/memory/service/stop', method: 'POST' });
  assert.equal(stopped.json().autostartSuppressed, true);
  assert.equal((await server.inject('/api/memory/status')).statusCode, 503);
  assert.equal((await server.inject('/api/memory/service/status')).json().state, 'stopped');
  const started = await server.inject({ url: '/api/memory/service/start', method: 'POST' });
  assert.equal(started.json().state, 'running');
  assert.equal((await server.inject('/api/memory/status')).json().count, 0);
});
test('memory status validates version, survives snapshot access and clears on runtime replacement', () => {
  const state = { version: 1, mode: 'auto', availability: 'ready', revision: 2, curator: 'committed' };
  const payload = {
    method: 'setStatus',
    statusKey: 'octopus-memory-state',
    statusText: JSON.stringify(state),
  };
  assert.deepEqual(projectMemoryState(payload), state);
  assert.equal(
    projectMemoryState({ ...payload, statusText: JSON.stringify({ ...state, version: 2 }) }),
    undefined
  );
  assert.equal(projectMemoryState({ ...payload, statusText: 'broken' }), undefined);
  let listener;
  const projection = new RuntimeEventProjection({
    onEvent: (fn) => {
      listener = fn;
      return () => {};
    },
  });
  let last;
  projection.onEvent((event) => {
    last = event;
  });
  const base = {
    runtimeId: 'r',
    epoch: 1,
    sessionId: 's',
    workspaceId: 'w',
    timestamp: new Date().toISOString(),
    sequence: 1,
  };
  listener({ ...base, type: 'extension-ui', payload });
  assert.deepEqual(projection.getMemory('s'), state);
  assert.deepEqual(last.memory, state);
  listener({ ...base, sequence: 2, type: 'runtime-state', payload: { state: 'recovering' } });
  assert.equal(projection.getMemory('s'), undefined);
  assert.equal(last.memory, null);
  projection.close();
});
