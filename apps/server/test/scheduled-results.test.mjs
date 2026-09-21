/**
 * @author Codex
 * @description Exercises result import, readonly viewing, restart deduplication and purge using real Pi files.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify from 'fastify';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { createDatabase } from '../dist/db/client.js';
import { sessions as table } from '../dist/db/schema.js';
import { SessionsService } from '../dist/modules/sessions/sessions.service.js';
import { SessionNotificationsRepository } from '../dist/modules/sessions/session-notifications.repository.js';
import { ScheduledResultsService } from '../dist/modules/scheduled-tasks/scheduled-results.service.js';
import { ApplicationError } from '../dist/lib/errors/application-error.js';

/**
 * Create an isolated Host and Pi execution file; fail immediately if any runtime is allocated.
 */
async function fixture(t, withSession = true) {
  const root = await mkdtemp(join(tmpdir(), 'scheduled-result-host-'));
  const database = createDatabase(':memory:');
  const server = Fastify();
  server.decorate('database', database);
  const workspaces = {
    resolve: async () => ({ id: 'w', cwd: root }),
    list: async () => [{ id: 'w', cwd: root }],
  };
  const runtime = {
    getControl: () => ({ restartRequired: false, changedConfigRoutes: [], restart: { status: 'idle' } }),
    deleteSession: async (_sessionId, remove) => remove(),
    onEvent: () => () => {},
    getBindingBySessionId: () => undefined,
    activateExisting: () => assert.fail('allocated runtime'),
    reserveExisting: () => assert.fail('reserved runtime'),
    withExisting: () => assert.fail('leased runtime'),
  };
  const sessions = new SessionsService(server, { workspaceService: workspaces, runtime });
  const notices = new SessionNotificationsRepository(database);
  const manager = SessionManager.create(root, root);
  if (withSession)
    manager.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: '# 执行完成\nfixture result' }],
      api: 'test',
      provider: 'test',
      model: 'test',
      usage: {},
      stopReason: 'stop',
      timestamp: 1,
    });
  const now = '2026-09-06T00:00:00.000Z';
  database.db
    .insert(table)
    .values({
      id: 'source',
      workspaceId: 'w',
      agentSessionId: 'origin',
      agentSessionPath: join(root, 'source.jsonl'),
      title: 'Source',
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const result = {
    run: {
      id: 'run',
      taskId: 'task',
      status: withSession ? 'succeeded' : 'needs_attention',
      scheduledFor: now,
      triggerSource: 'schedule',
      cancelRequestedAt: null,
      startedAt: null,
      settledAt: now,
      summary: withSession ? 'Done' : 'SCHEDULE_PERMISSION_REQUIRED',
      errorCode: null,
      createdAt: now,
    },
    taskName: 'General task',
    workspaceId: 'w',
    originSessionRef: 'origin',
    cwd: root,
    prompt: 'fixture instruction',
    session: withSession ? { id: manager.getSessionId(), path: manager.getSessionFile() } : null,
  };
  let purged = false;
  const scheduler = {
    result: async () => {
      if (purged) throw new ApplicationError('SCHEDULE_RUN_NOT_FOUND', 'Gone', { statusCode: 404 });
      return result;
    },
    get: async () => {
      throw new ApplicationError('SCHEDULE_TASK_NOT_FOUND', 'Archived tasks are hidden from get', {
        statusCode: 404,
      });
    },
    status: async () => ({ state: 'control-ready' }),
    history: async () => ({ items: [result.run] }),
  };
  const create = () =>
    new ScheduledResultsService(scheduler, sessions, notices, workspaces, join(root, 'reports'), (error) => {
      throw error;
    });
  const results = create();
  t.after(async () => {
    await results.close();
    sessions.dispose();
    await server.close();
    database.sqlite.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    manager,
    results,
    create,
    notices,
    sessions,
    result,
    purge: () => {
      purged = true;
    },
  };
}

test('execution view splits mixed tool calls without changing message pagination', async (t) => {
  const { results, manager } = await fixture(t);
  for (let index = 0; index < 20; index++) {
    manager.appendMessage({
      role: 'assistant',
      content: [
        { type: 'text', text: `检索说明 ${index}` },
        { type: 'toolCall', id: `call-${index}`, name: 'web_search', arguments: { queries: ['新闻'] } },
      ],
      api: 'test',
      provider: 'test',
      model: 'test',
      usage: {},
      stopReason: 'toolUse',
      timestamp: index + 2,
    });
  }
  const id = await results.ensure('w', 'task', 'run');
  const recent = await results.view('w', id, 0);
  assert.equal(recent.items.length, 40);
  assert.equal(recent.hasMore, true);
  assert.deepEqual(
    recent.items.slice(0, 2).map(({ role }) => role),
    ['assistant', 'toolCall']
  );
  assert.equal(new Set(recent.items.map(({ id }) => id)).size, 40);
  const older = await results.view('w', id, 20);
  assert.equal(older.items.length, 1);
  assert.match(older.items[0].text, /fixture result/);
  assert.equal(older.hasMore, false);
});

test('real execution Session imports once, links source, stays readonly and survives importer restart', async (t) => {
  const { results, create, notices, sessions } = await fixture(t);
  const [id, duplicate] = await Promise.all([
    results.ensure('w', 'task', 'run'),
    results.ensure('w', 'task', 'run'),
  ]);
  assert.equal(id, duplicate);
  assert.equal(notices.list().length, 1);
  assert.equal(notices.list(0, 'source')[0].sessionId, id);
  assert.match((await results.view('w', id, 0)).items[0].text, /fixture result/);
  assert.equal((await results.view('w', id, 0)).session.agentSessionPath, '');
  for (const operation of [
    () => sessions.activate(id),
    () => sessions.acquireSubscription(id),
    () => sessions.execute(id, { type: 'prompt', message: 'again' }),
    () => sessions.deriveSession(id, 'clone'),
    () => sessions.deleteSession(id, { deleteFiles: true }),
  ])
    await assert.rejects(operation(), { code: 'SESSION_EXECUTION_READ_ONLY' });
  notices.markRead('w', id, notices.list()[0].id);
  const restarted = create();
  assert.equal(await restarted.ensure('w', 'task', 'run'), id);
  assert.equal(notices.unreadCount(), 0);
  await restarted.close();
  await sessions.deleteSession(id);
  await assert.rejects(results.ensure('w', 'task', 'run'), { code: 'SESSION_NOT_FOUND' });
  assert.equal(notices.has('scheduled:w:run'), true);
});

test('predispatch failure creates a genuine system report and archive retains it until purge', async (t) => {
  const { results, notices, sessions, purge } = await fixture(t, false);
  const id = await results.ensure('w', 'task', 'run');
  const view = await results.view('w', id, 0);
  assert.equal(view.items[0].role, 'system');
  assert.match(view.items[0].text, /未创建模型执行会话/);
  await results.reconcile();
  assert.equal(sessions.getSession(id).execution.status, 'needs_attention');
  purge();
  await results.reconcile();
  assert.throws(() => sessions.getSession(id), { code: 'SESSION_NOT_FOUND' });
  assert.equal(notices.list().length, 0);
  assert.equal(sessions.getSession('source').notificationVersion, 0);
});

test('background catch-up imports settled history without a page opening or runtime allocation', async (t) => {
  const { results, notices } = await fixture(t);
  results.start();
  const deadline = Date.now() + 5000;
  while (notices.list().length === 0 && Date.now() < deadline) await delay(25);
  assert.equal(notices.list().length, 1);
  assert.equal(notices.unreadCount(), 1);
});
