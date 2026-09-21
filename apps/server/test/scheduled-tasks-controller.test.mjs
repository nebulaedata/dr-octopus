/**
 * @author Codex
 * @description Verifies Scheduler lifecycle HTTP routes remain a thin mapping over the Agent adapter.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerScheduledTasksController } from '../dist/modules/scheduled-tasks/scheduled-tasks.controller.js';

test('global history forwards optional workspace and date filters', async (t) => {
  const server = Fastify();
  t.after(() => server.close());
  let received;
  registerScheduledTasksController(server, {
    async historyCatalog(query) {
      received = query;
      return { items: [] };
    },
  });
  const response = await server.inject({
    method: 'GET',
    url: '/scheduled-tasks/history?offset=20&status=succeeded',
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual({ ...received }, { offset: '20', status: 'succeeded' });
});

test('global catalog forwards filters and the old page creation endpoint is absent', async (t) => {
  const server = Fastify();
  t.after(() => server.close());
  let query;
  registerScheduledTasksController(server, {
    async catalog(input) {
      query = input;
      return { items: [] };
    },
  });
  const result = await server.inject({
    method: 'GET',
    url: '/scheduled-tasks?workspaceId=w&offset=20&status=archived',
  });
  assert.equal(result.statusCode, 200);
  assert.deepEqual({ ...query }, { workspaceId: 'w', offset: '20', status: 'archived' });
  const create = await server.inject({
    method: 'POST',
    url: '/workspaces/w/sessions/s/scheduled-tasks',
    payload: {},
  });
  assert.equal(create.statusCode, 404);
});

test('history and archive routes preserve scope, query and mutation preconditions', async (t) => {
  const server = Fastify();
  t.after(() => server.close());
  const calls = [];
  registerScheduledTasksController(server, {
    async history(scope, id, query) {
      calls.push({ scope, id, query });
      return { items: [] };
    },
    async mutate(scope, request) {
      calls.push({ scope, request });
      return { task: { revision: 4 }, effect: 'deleted' };
    },
  });
  const history = await server.inject({
    method: 'GET',
    url: '/workspaces/w/scheduled-tasks/history?status=succeeded&offset=20',
  });
  assert.equal(history.statusCode, 200);
  assert.equal(calls[0].scope.workspaceId, 'w');
  assert.equal(calls[0].id, '');
  assert.equal(calls[0].query.status, 'succeeded');
  assert.equal(calls[0].query.offset, '20');
  const archive = await server.inject({
    method: 'POST',
    url: '/workspaces/w/scheduled-tasks/t/archive',
    headers: { 'idempotency-key': 'archive-1', 'if-match': '"3"' },
    payload: {},
  });
  assert.equal(archive.statusCode, 200);
  assert.equal(calls[1].request.operation, 'delete');
  assert.equal(calls[1].request.revision, 3);
  assert.equal(calls[1].request.key, 'archive-1');
});

test('Scheduler lifecycle routes forward status and explicit controls', async () => {
  const calls = [];
  const server = Fastify();
  registerScheduledTasksController(server, {
    async status() {
      calls.push('status');
      return { state: 'stopped' };
    },
    async control(action) {
      calls.push(action);
      return action === 'stop' ? { state: 'stopped' } : { state: 'control-ready' };
    },
    async settings() {
      calls.push('settings');
      return { timezone: 'UTC', maxConcurrentRuns: 3, revision: 1, updatedAt: 'now' };
    },
    async updateSettings(input) {
      calls.push(['update-settings', input]);
      return { ...input, revision: input.revision + 1, updatedAt: 'later' };
    },
  });

  const status = await server.inject({ method: 'GET', url: '/scheduler/service' });
  assert.equal(status.statusCode, 200);
  assert.deepEqual(status.json(), { state: 'stopped' });

  for (const action of ['start', 'restart', 'stop']) {
    const response = await server.inject({ method: 'POST', url: `/scheduler/service/${action}` });
    assert.equal(response.statusCode, 200);
  }
  assert.deepEqual(calls, ['status', 'start', 'restart', 'stop']);

  const settings = await server.inject({ method: 'GET', url: '/scheduler/settings' });
  assert.equal(settings.statusCode, 200);
  const updated = await server.inject({
    method: 'PUT',
    url: '/scheduler/settings',
    payload: { timezone: 'Asia/Shanghai', maxConcurrentRuns: 5, revision: 1 },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.headers.etag, '"2"');
  assert.deepEqual(calls.slice(4), [
    'settings',
    ['update-settings', { timezone: 'Asia/Shanghai', maxConcurrentRuns: 5, revision: 1 }],
  ]);
  await server.close();
});
