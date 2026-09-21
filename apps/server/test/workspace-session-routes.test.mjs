/**
 * @author Codex
 * @description Verifies Workspace-scoped Session HTTP resources and Web-only title mutation routing.
 */

import assert from 'node:assert/strict';
import Fastify from 'fastify';
import test from 'node:test';
import { registerSessionsController } from '../dist/modules/sessions/sessions.controller.js';

/**
 * Mounts the isolated Session controller at its production API prefix.
 */
function registerSessionApi(server, service) {
  /**
   * Declares the Fastify plugin boundary required for prefix encapsulation.
   */
  server.register(
    function sessionApi(apiServer, _options, done) {
      registerSessionsController(apiServer, service);
      done();
    },
    { prefix: '/api' }
  );
}

test('restart validates explicit generation targets and replays a request without repeating side effects', async () => {
  const server = Fastify();
  let calls = 0;
  const result = { id: 'session', runtime: { runtimeId: 'new', epoch: 2 } };
  registerSessionApi(server, {
    assertWorkspaceSession: async () => undefined,
    restart: async (_id, body) => {
      calls++;
      assert.equal(body.expectedRuntime, null);
      return result;
    },
  });
  try {
    const url = '/api/workspaces/workspace/sessions/session/restart';
    const invalid = await server.inject({ method: 'POST', url, payload: { allowInterrupt: false } });
    assert.equal(invalid.statusCode, 400);
    assert.equal(calls, 0);
    const request = {
      method: 'POST',
      url,
      headers: { 'idempotency-key': 'restart-1' },
      payload: { expectedRuntime: null, allowInterrupt: false },
    };
    const responses = await Promise.all([server.inject(request), server.inject(request)]);
    assert.equal(calls, 1);
    for (const response of responses) {
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), result);
    }
    const conflict = await server.inject({
      ...request,
      payload: { expectedRuntime: null, allowInterrupt: true },
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(calls, 1);
  } finally {
    await server.close();
  }
});

test('Session routes require a Workspace parent and preserve catalog title semantics', async () => {
  const server = Fastify();
  const calls = [];
  const session = {
    id: 'web-session-a',
    workspaceId: 'workspace-a',
    title: 'Renamed in Web',
    createdAt: '0',
    updatedAt: '0',
    preferences: {
      steeringMode: 'one-at-a-time',
      followUpMode: 'one-at-a-time',
      autoCompactionEnabled: true,
      autoRetryEnabled: true,
    },
  };
  registerSessionApi(server, {
    async listSessions(workspaceId, search) {
      calls.push(['list', workspaceId, search]);
      return [session];
    },
    async assertWorkspaceSession(workspaceId, sessionId) {
      calls.push(['scope', workspaceId, sessionId]);
    },
    async renameSession(sessionId, title) {
      calls.push(['rename', sessionId, title]);
      return { ...session, title };
    },
  });

  const list = await server.inject({
    method: 'GET',
    url: '/api/workspaces/workspace-a/sessions?search=Renamed',
  });
  assert.equal(list.statusCode, 200);
  assert.deepEqual(calls[0], ['list', 'workspace-a', 'Renamed']);

  const rename = await server.inject({
    method: 'PATCH',
    url: '/api/workspaces/workspace-a/sessions/web-session-a',
    headers: { 'idempotency-key': 'rename-request-a' },
    payload: { title: 'Browser label' },
  });
  assert.equal(rename.statusCode, 200);
  assert.equal(rename.json().title, 'Browser label');
  const replay = await server.inject({
    method: 'PATCH',
    url: '/api/workspaces/workspace-a/sessions/web-session-a',
    headers: { 'idempotency-key': 'rename-request-a' },
    payload: { title: 'Browser label' },
  });
  assert.equal(replay.statusCode, 200);
  const conflict = await server.inject({
    method: 'PATCH',
    url: '/api/workspaces/workspace-a/sessions/web-session-a',
    headers: { 'idempotency-key': 'rename-request-a' },
    payload: { title: 'Different label' },
  });
  assert.equal(conflict.statusCode, 409);
  assert.equal(calls.filter(([type]) => type === 'rename').length, 1);

  const legacy = await server.inject({ method: 'GET', url: '/api/sessions' });
  assert.equal(legacy.statusCode, 404);
  await server.close();
});
