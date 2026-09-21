/**
 * @author Codex
 * @description Verifies HTTP and WebSocket Session interfaces share Slot fencing under concurrency and capacity pressure.
 */

import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import WebSocket from 'ws';
import { SessionRuntimeCoordinator } from '../dist/lib/runtime/index.js';
import { createDatabase } from '../dist/db/client.js';
import { AttachmentsService } from '../dist/modules/attachments/attachments.service.js';
import { ChannelService } from '../dist/modules/channel/channel.service.js';
import { registerChannelController } from '../dist/modules/channel/channel.controller.js';
import { SessionsRepository } from '../dist/modules/sessions/sessions.repository.js';
import { SessionsService } from '../dist/modules/sessions/sessions.service.js';
import { registerSessionsController } from '../dist/modules/sessions/sessions.controller.js';

const rpcFixturePath = fileURLToPath(new URL('./fixtures/mock-rpc-entry.mjs', import.meta.url));

/**
 * Creates a real HTTP/WebSocket application boundary over deterministic Runtime infrastructure.
 */
async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'octopus-cross-interface-'));
  const workspaceCwd = join(root, 'workspace');
  await mkdir(workspaceCwd);
  const workspace = {
    schemaVersion: 1,
    id: 'workspace-a',
    kind: 'project',
    name: 'Workspace A',
    slug: 'workspace-a',
    cwd: workspaceCwd,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
  const database = createDatabase(':memory:');
  const repository = new SessionsRepository(database);
  for (const sessionId of ['session-a', 'session-b']) {
    const sessionPath = join(root, `${sessionId}.jsonl`);
    await writeFile(
      sessionPath,
      `${JSON.stringify({ type: 'session', version: 3, id: sessionId, timestamp: new Date(0).toISOString(), cwd: workspaceCwd })}\n`,
      'utf8'
    );
    repository.upsert({
      id: sessionId,
      workspaceId: workspace.id,
      agentSessionId: sessionId,
      agentSessionPath: sessionPath,
      title: sessionId,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    });
  }
  process.env.MOCK_SESSION_ID = 'session-a';
  const runtime = new SessionRuntimeCoordinator({
    processOptions: { entryPath: rpcFixturePath, requestTimeoutMs: 2_000 },
    limits: { maxActiveRuntimes: 1, maxActiveRuntimesPerWorkspace: 1, idleTtlMs: 0 },
  });
  const server = Fastify();
  server.decorate('database', database);
  const sessions = new SessionsService(server, {
    runtime,
    sessionsRepository: repository,
    messageFeedbackRepository: {
      listBySession: () => [],
      upsert: () => ({ entryId: '', rating: 'up' }),
    },
    workspaceService: {
      async resolve(selector) {
        assert.equal(selector.id, workspace.id);
        return workspace;
      },
    },
  });
  const attachments = new AttachmentsService(server, { maxBytes: 1024, ttlMs: 60_000 });
  await attachments.ready();
  const channel = new ChannelService(
    server,
    {
      sessionsService: sessions,
      attachmentsService: attachments,
    },
    { maxSubscriptions: 4 }
  );
  await server.register(websocket);
  registerChannelController(server, channel);
  await server.register(
    async (api) => {
      registerSessionsController(api, sessions);
    },
    { prefix: '/api' }
  );
  await server.listen({ host: '127.0.0.1', port: 0 });
  const address = server.server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, 'object');
  return {
    root,
    server,
    sessions,
    port: address.port,
    async close() {
      await server.close();
      await attachments.close();
      sessions.dispose();
      await runtime.close();
      database.sqlite.close();
      await rm(root, { recursive: true, force: true });
      delete process.env.MOCK_SESSION_ID;
    },
  };
}

/**
 * Waits for one collected WebSocket message matching the expected protocol shape.
 */
async function waitForMessage(messages, predicate, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = messages.find(predicate);
    if (match !== undefined) {
      return match;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for WebSocket message.');
}

test('HTTP bootstrap resources and WebSocket subscribe share one fenced Runtime generation', async () => {
  const fixture = await createFixture();
  const messages = [];
  const socket = new WebSocket(`ws://127.0.0.1:${String(fixture.port)}/ws`, {
    headers: { origin: 'http://localhost:5173' },
  });
  socket.on('message', (data) => messages.push(JSON.parse(data.toString())));
  try {
    await once(socket, 'open');
    await waitForMessage(messages, (message) => message.type === 'connection.ready');
    socket.send(
      JSON.stringify({
        type: 'session.subscribe',
        requestId: 'subscribe-a',
        sessionId: 'session-a',
      })
    );

    const base = '/api/workspaces/workspace-a/sessions/session-a';
    const responses = await Promise.all([
      ...Array.from({ length: 8 }, () => fixture.server.inject({ method: 'GET', url: `${base}/bootstrap` })),
      fixture.server.inject({ method: 'GET', url: `${base}/commands` }),
      fixture.server.inject({ method: 'GET', url: `${base}/models` }),
    ]);
    assert.equal(
      responses.every((response) => response.statusCode === 200),
      true
    );
    const snapshots = responses.slice(0, 8).map((response) => response.json());
    assert.equal(
      snapshots.every((snapshot) => snapshot.readiness.ready === true),
      true
    );
    assert.equal(
      snapshots.every((snapshot) => Array.isArray(snapshot.commands)),
      true
    );
    assert.equal(
      snapshots.every((snapshot) => Array.isArray(snapshot.models)),
      true
    );
    const generations = new Set(
      snapshots.map((snapshot) => `${snapshot.runtime.runtimeId}:${String(snapshot.runtime.epoch)}`)
    );
    assert.equal(generations.size, 1);

    const subscribed = await waitForMessage(
      messages,
      (message) => message.type === 'session.subscribed' && message.requestId === 'subscribe-a'
    );
    assert.equal(`${subscribed.runtime.runtimeId}:${String(subscribed.runtime.epoch)}`, [...generations][0]);

    process.env.MOCK_SESSION_ID = 'session-b';
    const blocked = await fixture.server.inject({
      method: 'GET',
      url: '/api/workspaces/workspace-a/sessions/session-b/snapshot',
    });
    assert.equal(blocked.statusCode, 429);

    socket.send(
      JSON.stringify({
        type: 'session.unsubscribe',
        requestId: 'unsubscribe-a',
        sessionId: 'session-a',
      })
    );
    await waitForMessage(
      messages,
      (message) => message.type === 'session.unsubscribed' && message.requestId === 'unsubscribe-a'
    );
    const admitted = await fixture.server.inject({
      method: 'GET',
      url: '/api/workspaces/workspace-a/sessions/session-b/snapshot',
    });
    assert.equal(admitted.statusCode, 200);
    assert.equal(admitted.json().runtime.epoch, 1);
  } finally {
    socket.close();
    await fixture.close();
  }
});

test('concurrent HTTP reads recover one crashed WebSocket Runtime without changing its Slot epoch', async () => {
  const fixture = await createFixture();
  const messages = [];
  const socket = new WebSocket(`ws://127.0.0.1:${String(fixture.port)}/ws`, {
    headers: { origin: 'http://localhost:5173' },
  });
  socket.on('message', (data) => messages.push(JSON.parse(data.toString())));
  try {
    await once(socket, 'open');
    socket.send(
      JSON.stringify({
        type: 'session.subscribe',
        requestId: 'subscribe-crash',
        sessionId: 'session-a',
      })
    );
    const subscribed = await waitForMessage(
      messages,
      (message) => message.type === 'session.subscribed' && message.requestId === 'subscribe-crash'
    );
    socket.send(
      JSON.stringify({
        type: 'agent.prompt',
        requestId: 'crash-command',
        sessionId: 'session-a',
        payload: { message: '__crash__' },
      })
    );
    await waitForMessage(
      messages,
      (message) => message.type === 'command.ack' && message.requestId === 'crash-command'
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    const base = '/api/workspaces/workspace-a/sessions/session-a';
    const recovered = await Promise.all([
      fixture.server.inject({ method: 'GET', url: `${base}/snapshot` }),
      fixture.server.inject({ method: 'GET', url: `${base}/commands` }),
      fixture.server.inject({ method: 'GET', url: `${base}/models` }),
    ]);
    assert.equal(
      recovered.every((response) => response.statusCode === 200),
      true
    );
    const runtime = recovered[0].json().runtime;
    assert.equal(runtime.runtimeId, subscribed.runtime.runtimeId);
    assert.equal(runtime.epoch, subscribed.runtime.epoch);
  } finally {
    socket.close();
    await fixture.close();
  }
});
