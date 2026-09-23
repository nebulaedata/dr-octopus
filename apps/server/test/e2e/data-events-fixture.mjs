/**
 * @author Codex
 * @description Composes isolated real HTTP/SSE repositories and Scheduler daemon for browser regression tests.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { createDatabase } from '../../dist/db/client.js';
import { DataEventsService } from '../../dist/modules/data-events/data-events.service.js';
import { registerDataEventsController } from '../../dist/modules/data-events/data-events.controller.js';
import { SessionsRepository } from '../../dist/modules/sessions/sessions.repository.js';
import { createSessionsService } from '../../dist/modules/sessions/index.js';
import { SessionNotificationsRepository } from '../../dist/modules/sessions/sessions.repository.js';
import { registerSessionsController } from '../../dist/modules/sessions/sessions.controller.js';
import { registerSessionNotificationsController } from '../../dist/modules/sessions/sessions.controller.js';
import { registerScheduledTasksController } from '../../dist/modules/scheduled-tasks/scheduled-tasks.controller.js';
import { ScheduledTasksService } from '../../dist/modules/scheduled-tasks/scheduled-tasks.service.js';
import {
  subscribeSchedulerChanges,
  createSchedulerClient,
  startSchedulerService,
  stopSchedulerService,
} from '@octopus/agent';

/**
 * Use a temporary profile and prevent browser navigation from accidentally allocating a model runtime.
 */
export async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'octopus-sse-browser-'));
  const agentDir = join(root, 'agent');
  const database = createDatabase(':memory:');
  const app = Fastify();
  const dataEvents = new DataEventsService();
  const streams = new Set();
  const requests = [];
  const workspace = {
    schemaVersion: 1,
    id: 'w',
    name: 'SSE Workspace',
    kind: 'general',
    cwd: root,
    createdAt: '2026-09-07T00:00:00Z',
    updatedAt: '2026-09-07T00:00:00Z',
  };
  const workspaces = { list: async () => [workspace], resolve: async () => workspace };
  const repository = new SessionsRepository(database, (workspaceId) =>
    dataEvents.publish({ resource: 'sessions', workspaceId })
  );
  app.decorate('database', database);
  const runtime = {
    getControl: () => ({ restartRequired: false, changedConfigRoutes: [], restart: { status: 'idle' } }),
    onEvent: () => () => {},
    getBindingBySessionId: () => undefined,
    activateExisting: () => assert.fail('E2E must not allocate model runtimes'),
  };
  const sessions = createSessionsService(app, {
    runtime,
    workspaceService: workspaces,
    sessionsRepository: repository,
  });
  const notices = new SessionNotificationsRepository(database, (workspaceId) => {
    dataEvents.publish({ resource: 'sessions', workspaceId });
    dataEvents.publish({ resource: 'notifications', workspaceId });
  });
  repository.upsert({
    id: 'seed',
    workspaceId: 'w',
    agentSessionId: 'seed',
    agentSessionPath: join(root, 'seed.jsonl'),
    title: 'Initial session',
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  });
  await startSchedulerService(agentDir);
  const scheduler = new ScheduledTasksService({ agentDir, workspaces, sessions });
  const client = createSchedulerClient({
    agentDir,
    workspaceId: 'w',
    cwd: root,
    configRevision: workspace.updatedAt,
    autoEnsure: false,
  });
  const subscription = subscribeSchedulerChanges(agentDir, () =>
    dataEvents.publish({ resource: 'scheduler' })
  );
  await app.register(websocket);
  app.get('/ws', { websocket: true }, () => {});
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/api/')) requests.push({ method: request.method, url: request.url });
    if (request.url === '/api/data/events') {
      streams.add(reply.raw);
      reply.raw.once('close', () => streams.delete(reply.raw));
    }
  });
  app.register(
    (scope, _options, done) => {
      registerDataEventsController(scope, dataEvents, (origin) =>
        /^http:\/\/(127\.0\.0\.1|localhost):/.test(origin)
      );
      scope.get('/workspaces', () => [workspace]);
      registerSessionsController(scope, sessions);
      registerSessionNotificationsController(scope, notices, sessions);
      registerScheduledTasksController(scope, scheduler);
      done();
    },
    { prefix: '/api' }
  );
  app.get('/e2e/stats', () => ({ requests, streams: streams.size }));
  app.post('/e2e/rename', async (request) => repository.rename('seed', request.body.title));
  app.post('/e2e/notice', async () => {
    notices.publish({
      eventKey: `notice-${Date.now()}`,
      workspaceId: 'w',
      sessionId: 'seed',
      title: 'Pushed notice',
      summary: 'Durable notification',
      status: 'succeeded',
      createdAt: new Date().toISOString(),
    });
    return { version: notices.list()[0].id };
  });
  app.post('/e2e/disconnect', async () => {
    for (const response of streams) response.destroy();
    repository.rename('seed', 'Recovered session');
    return { ok: true };
  });
  app.post('/e2e/task', async () =>
    client.create(
      {
        name: 'Pushed scheduler task',
        description: '',
        prompt: 'Fixture only',
        schedule: { type: 'once', at: '2099-01-01T00:00:00Z' },
        enabled: false,
        misfirePolicy: 'coalesce',
        overlapPolicy: 'queue-one',
        timeoutMs: 60_000,
      },
      `create-${Date.now()}`
    )
  );
  await app.listen({ host: '127.0.0.1', port: 0 });
  return {
    url: `http://127.0.0.1:${app.server.address().port}`,
    /**
     * Close streams and the exact test daemon before removing its uniquely allocated profile.
     */
    async close() {
      await subscription.close();
      client.close();
      scheduler.close();
      await app.close();
      sessions.dispose();
      database.sqlite.close();
      await stopSchedulerService(agentDir);
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
  };
}
