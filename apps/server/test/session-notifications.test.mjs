/**
 * @author Codex
 * @description Exercises durable notice deduplication, workspace fencing and concurrent read receipts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabase } from '../dist/db/client.js';
import { sessions } from '../dist/db/schema.js';
import { SessionNotificationsRepository } from '../dist/modules/sessions/session-notifications.repository.js';

/**
 * Seed dormant catalog rows without allocating an Agent runtime.
 */
function fixture() {
  const database = createDatabase(':memory:');
  for (const id of ['source', 'result'])
    database.db
      .insert(sessions)
      .values({
        id,
        workspaceId: 'general',
        agentSessionId: `pi-${id}`,
        agentSessionPath: `${id}.jsonl`,
        title: id,
        createdAt: '2026-09-06T00:00:00.000Z',
        updatedAt: '2026-09-06T00:00:00.000Z',
      })
      .run();
  const repository = new SessionNotificationsRepository(database);
  const notice = {
    eventKey: 'run:1',
    workspaceId: 'general',
    sessionId: 'result',
    originSessionId: 'source',
    runId: '1',
    title: 'Result',
    summary: 'Done',
    status: 'succeeded',
    createdAt: '2026-09-06T00:00:00.000Z',
  };
  return { database, repository, notice };
}

test('duplicate delivery stays read while a concurrent later result stays unread', () => {
  const { database, repository, notice } = fixture();
  try {
    repository.publish(notice);
    const firstVersion = repository.list()[0].id;
    repository.publish({ ...notice, eventKey: 'run:2', runId: '2' });
    repository.markRead('general', 'result', firstVersion);
    assert.equal(repository.unreadCount(), 1);
    repository.publish(notice);
    assert.equal(repository.list().length, 2);
    assert.equal(repository.unreadCount(), 1);
    repository.markRead('general', 'result', repository.list()[0].id);
    repository.publish({ ...notice, eventKey: 'run:2', runId: '2' });
    assert.equal(repository.unreadCount(), 0);
    const source = database.db
      .select()
      .from(sessions)
      .all()
      .find((row) => row.id === 'source');
    assert.ok(source.notificationVersion > source.readVersion);
  } finally {
    database.sqlite.close();
  }
});

test('read receipt is workspace fenced, bounded and monotonic', () => {
  const { database, repository, notice } = fixture();
  try {
    repository.publish(notice);
    repository.markRead('another', 'result', 1000);
    assert.equal(repository.unreadCount(), 1);
    repository.markRead('general', 'result', 1000);
    repository.markRead('general', 'result', 0);
    assert.equal(repository.unreadCount(), 0);
    const result = database.db
      .select()
      .from(sessions)
      .all()
      .find((row) => row.id === 'result');
    assert.equal(result.readVersion, result.notificationVersion);
  } finally {
    database.sqlite.close();
  }
});

test('source lookup returns linked results and preserves receipt after catalog removal', () => {
  const { database, repository, notice } = fixture();
  try {
    repository.publish(notice);
    assert.equal(repository.list(0, 'source')[0].sessionId, 'result');
    database.sqlite.prepare('DELETE FROM sessions WHERE id = ?').run('result');
    assert.equal(repository.list().length, 0);
    assert.equal(repository.unreadCount(), 0);
    assert.equal(repository.has(notice.eventKey), true);
  } finally {
    database.sqlite.close();
  }
});

test('notification API pages tied timestamps without overlap and permits returning to page one', async () => {
  const { database, repository, notice } = fixture();
  const { default: Fastify } = await import('fastify');
  const { registerSessionNotificationsController } =
    await import('../dist/modules/sessions/session-notifications.controller.js');
  const server = Fastify();
  registerSessionNotificationsController(server, repository, {});
  try {
    for (let index = 0; index < 41; index++) {
      repository.publish({ ...notice, eventKey: 'page:' + index, runId: String(index) });
    }
    const first = (await server.inject('/notifications?offset=0')).json();
    const second = (await server.inject('/notifications?offset=20')).json();
    const last = (await server.inject('/notifications?offset=40')).json();
    assert.deepEqual([first.items.length, second.items.length, last.items.length], [20, 20, 1]);
    assert.deepEqual([first.hasMore, second.hasMore, last.hasMore], [true, true, false]);
    assert.equal(new Set([...first.items, ...second.items, ...last.items].map((item) => item.id)).size, 41);
    assert.equal(last.unreadCount, 41);
    assert.deepEqual((await server.inject('/notifications?offset=0')).json(), first);
    assert.equal((await server.inject('/notifications?offset=-1')).statusCode, 400);
    assert.equal((await server.inject({ method: 'POST', url: '/notifications/read-all' })).statusCode, 200);
    assert.equal(repository.unreadCount(), 0);
    assert.ok(repository.list(20).every((item) => !item.unread));
    assert.equal(repository.list(40).length, 1);
  } finally {
    await server.close();
    database.sqlite.close();
  }
});

test('mark all read covers workspaces and source pointers without acknowledging later notices', () => {
  const { database, notice } = fixture();
  const changes = [];
  const repository = new SessionNotificationsRepository(database, (workspaceId) => changes.push(workspaceId));
  try {
    database.db
      .insert(sessions)
      .values({
        id: 'other',
        workspaceId: 'other-workspace',
        title: 'Other',
        agentSessionId: 'other-pi',
        agentSessionPath: 'other.jsonl',
        createdAt: notice.createdAt,
        updatedAt: notice.createdAt,
      })
      .run();
    repository.publish(notice);
    repository.publish({
      ...notice,
      eventKey: 'other:1',
      workspaceId: 'other-workspace',
      sessionId: 'other',
      originSessionId: null,
    });
    changes.length = 0;
    repository.markAllRead();
    assert.equal(repository.unreadCount(), 0);
    assert.deepEqual(changes.sort(), ['general', 'other-workspace']);
    assert.ok(
      database.db
        .select()
        .from(sessions)
        .all()
        .every((row) => row.readVersion === row.notificationVersion)
    );
    changes.length = 0;
    repository.markAllRead();
    assert.deepEqual(changes, []);
    repository.publish({ ...notice, eventKey: 'later:1', runId: 'later' });
    assert.equal(repository.unreadCount(), 1);
    assert.equal(repository.list()[0].unread, true);
  } finally {
    database.sqlite.close();
  }
});

test('focused settlements leave no record and can notify if repeated after losing focus', async () => {
  const { subscribeSessionCompletionNotices } =
    await import('../dist/modules/sessions/session-completion-notices.js');
  const { database } = fixture();
  const changes = [];
  const repository = new SessionNotificationsRepository(database, (id) => changes.push(id));
  let onEvent;
  let focused = true;
  let entryId = 'first';
  const session = database.db
    .select()
    .from(sessions)
    .all()
    .find((row) => row.id === 'result');
  const errors = [];
  const unsubscribe = subscribeSessionCompletionNotices(
    {
      onEvent: (callback) => {
        onEvent = callback;
        return () => {
          onEvent = undefined;
        };
      },
      getSession: () => session,
      getEntries: () => ({
        leafId: entryId,
        entries: [
          {
            id: entryId,
            type: 'message',
            message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Done' }] },
          },
        ],
      }),
    },
    repository,
    (error) => errors.push(error),
    () => focused
  );
  const event = {
    type: 'agent.event',
    sessionId: 'result',
    timestamp: '2026-09-08T00:00:00Z',
    payload: { type: 'agent_settled' },
  };
  try {
    onEvent(event);
    assert.equal(repository.has('reply:result:first'), false);
    assert.equal(
      database.sqlite.prepare('SELECT count(*) AS count FROM session_notifications').get().count,
      0
    );
    assert.equal(repository.list().length, 0);
    assert.equal(repository.list(0, 'result').length, 0);
    assert.equal(repository.unreadCount(), 0);
    assert.deepEqual(changes, []);
    assert.equal(
      database.db
        .select()
        .from(sessions)
        .all()
        .find((row) => row.id === 'result').notificationVersion,
      0
    );
    focused = false;
    onEvent(event);
    assert.equal(repository.has('reply:result:first'), true);
    assert.equal(repository.unreadCount(), 1);
    entryId = 'second';
    onEvent(event);
    onEvent(event);
    assert.equal(repository.list().length, 2);
    assert.equal(repository.unreadCount(), 2);
    focused = true;
    entryId = 'third';
    onEvent(event);
    assert.equal(repository.has('reply:result:third'), false);
    assert.equal(repository.unreadCount(), 2);
    repository.markAllRead();
    assert.equal(repository.unreadCount(), 0);
    assert.deepEqual(errors, []);
  } finally {
    unsubscribe();
    database.sqlite.close();
  }
});
