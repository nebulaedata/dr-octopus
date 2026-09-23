/**
 * @author Codex
 * @description Verifies real HTTP SSE transport, committed projections, origin fencing and lifecycle cleanup.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import Fastify from 'fastify';
import { DataEventsService } from '../dist/modules/data-events/data-events.service.js';
import { registerDataEventsController } from '../dist/modules/data-events/data-events.controller.js';
import { SessionsRepository } from '../dist/modules/sessions/sessions.repository.js';
import { SessionNotificationsRepository } from '../dist/modules/sessions/sessions.repository.js';
import { createDatabase } from '../dist/db/client.js';
import { EventEmitter } from 'node:events';
import { ScheduledResultSynchronization } from '../dist/modules/scheduled-tasks/scheduled-tasks.service.js';

/**
 * Seed a valid dormant Session without creating a model runtime.
 */
function session(id = 'one') {
  return {
    id,
    workspaceId: 'w',
    agentSessionId: id,
    agentSessionPath: `${id}.jsonl`,
    title: id,
    createdAt: '2026-09-07T00:00:00Z',
    updatedAt: '2026-09-07T00:00:00Z',
  };
}

test('coalesces by resource and workspace, isolates failed consumers and drops closed work', async () => {
  const events = new DataEventsService();
  const seen = [];
  events.subscribe(() => {
    throw new Error('consumer failed');
  });
  const off = events.subscribe((change) => seen.push(change));
  events.publish({ resource: 'sessions', workspaceId: 'w' });
  events.publish({ resource: 'sessions', workspaceId: 'w' });
  events.publish({ resource: 'sessions', workspaceId: 'other' });
  await delay(150);
  assert.equal(seen.length, 2);
  off();
  events.publish({ resource: 'notifications' });
  events.close();
  await delay(150);
  assert.equal(seen.length, 2);
});

test('metadata changes and notice/read transactions publish only committed projections', () => {
  const database = createDatabase(':memory:');
  const seen = [];
  const repository = new SessionsRepository(database, (workspace) => seen.push(workspace));
  const notices = new SessionNotificationsRepository(database, (workspace) => {
    assert.equal(database.sqlite.inTransaction, false);
    seen.push(workspace);
  });
  try {
    repository.createDraft(session());
    repository.rename('one', 'Draft');
    assert.equal(seen.length, 0);
    repository.publishDraft('one', 'Published');
    repository.rename('one', 'Renamed');
    repository.setPinned('one', true);
    assert.equal(seen.length, 3);
    const notice = {
      eventKey: 'run:1',
      workspaceId: 'w',
      sessionId: 'result',
      title: 'Done',
      summary: '',
      status: 'succeeded',
      createdAt: session().createdAt,
    };
    notices.registerResult(session('result'), notice);
    assert.equal(notices.unreadCount(), 1);
    notices.markRead('w', 'result', notices.list()[0].id);
    assert.equal(notices.unreadCount(), 0);
    const count = seen.length;
    assert.throws(() => notices.registerResult(session('result'), { ...notice, eventKey: 'collision' }));
    assert.equal(seen.length, count);
    repository.delete('one');
    assert.equal(seen.at(-1), 'w');
  } finally {
    database.sqlite.close();
  }
});

test(
  'real SSE rejects foreign Origin, sends ready before changes and closes during preClose',
  { timeout: 5000 },
  async () => {
    const server = Fastify();
    const events = new DataEventsService();
    registerDataEventsController(server, events, ['http://localhost']);
    await server.listen({ host: '127.0.0.1', port: 0 });
    const url = `http://127.0.0.1:${server.server.address().port}/data/events`;
    const controller = new AbortController();
    try {
      assert.equal((await fetch(url, { headers: { origin: 'https://foreign.test' } })).status, 403);
      const response = await fetch(url, { signal: controller.signal });
      assert.match(response.headers.get('content-type'), /text\/event-stream/);
      const reader = response.body.getReader();
      assert.match(new TextDecoder().decode((await reader.read()).value), /event: ready/);
      events.publish({ resource: 'sessions', workspaceId: 'w' });
      assert.match(new TextDecoder().decode((await reader.read()).value), /"workspaceId":"w"/);
      await server.close();
      assert.equal((await reader.read()).done, true);
    } finally {
      controller.abort();
      await server.close();
    }
  }
);

test('slow SSE consumers are disconnected without retaining a heartbeat or subscription', async () => {
  const events = new DataEventsService();
  let handler;
  registerDataEventsController(
    {
      addHook() {},
      get(_path, callback) {
        handler = callback;
      },
    },
    events,
    []
  );
  const response = new EventEmitter();
  let writes = 0;
  let ended = 0;
  let destroyed = 0;
  Object.assign(response, {
    writeHead() {},
    setHeader() {},
    write() {
      writes++;
      return false;
    },
    destroy() {
      destroyed++;
      response.emit('close');
    },
    end() {
      ended++;
      response.emit('close');
    },
  });
  handler(
    { headers: {} },
    {
      raw: response,
      hijack() {},
      getHeaders() {
        return {};
      },
    }
  );
  events.publish({ resource: 'sessions' });
  await delay(150);
  assert.equal(writes, 1);
  assert.equal(ended, 0);
  assert.equal(destroyed, 1);
  events.close();
});

test('Scheduler invalidation during an active reconciliation retains exactly one trailing pass', async () => {
  let calls = 0;
  let release;
  const scheduler = {
    status() {
      calls++;
      return calls === 1
        ? new Promise((resolve) => {
            release = resolve;
          })
        : Promise.resolve({ state: 'stopped' });
    },
  };
  const results = new ScheduledResultSynchronization(scheduler, {}, {}, {}, '.', (error) => {
    throw error;
  });
  results.requestSync();
  await delay(150);
  assert.equal(calls, 1);
  for (let i = 0; i < 20; i++) results.requestSync();
  release({ state: 'stopped' });
  await delay(150);
  assert.equal(calls, 2);
  await results.close();
  results.requestSync();
  await delay(150);
  assert.equal(calls, 2);
});
