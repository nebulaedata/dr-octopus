/**
 * @author Codex
 * @description Verifies persisted history is Workspace-scoped and independent of runtime readiness.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { SessionsService } from '../dist/modules/sessions/sessions.service.js';
import { registerSessionsController } from '../dist/modules/sessions/sessions.controller.js';

test('history reads only the current branch and keeps entry metadata without activating Pi', () => {
  const entries = [
    { type: 'model_change', id: 'model' },
    {
      type: 'message',
      id: 'user',
      timestamp: '2026-01-01T00:00:00Z',
      message: { role: 'user', content: 'hello' },
    },
    {
      type: 'message',
      id: 'assistant',
      timestamp: '2026-01-01T00:00:01Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'answer' }] },
    },
  ];
  const service = new SessionsService(
    {},
    {
      runtime: { onEvent: () => () => {}, activateExisting: () => assert.fail('history must not activate') },
      workspaceService: {},
      sessionsRepository: { getRow: () => ({ id: 'session', agentSessionPath: '/fixture/session.jsonl' }) },
      messageFeedbackRepository: { listBySession: () => [{ entryId: 'assistant', rating: 'up' }] },
      piSessionsRepository: {
        getBranch(path) {
          assert.equal(path, '/fixture/session.jsonl');
          return entries;
        },
        getEntries() {
          assert.fail('append-order history includes abandoned branches');
        },
      },
    }
  );
  const history = service.getHistory('session');
  assert.equal(history.sessionId, 'session');
  assert.deepEqual(
    history.messages.map((message) => message.entryId),
    ['user', 'assistant']
  );
  assert.equal(history.messages[1].persistedAt, entries[2].timestamp);
  assert.equal(history.messageFeedback[0].rating, 'up');
  assert.equal('runtime' in history, false);
  assert.equal('readiness' in history, false);
});

test('history HTTP route checks Workspace ownership before reading persisted content', async () => {
  const server = Fastify();
  let reads = 0;
  registerSessionsController(server, {
    async assertWorkspaceSession(workspaceId) {
      if (workspaceId !== 'allowed') throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
    },
    getHistory(sessionId) {
      reads++;
      return { sessionId, messages: [], messageFeedback: [] };
    },
  });
  try {
    assert.equal((await server.inject('/workspaces/foreign/sessions/session/history')).statusCode, 403);
    assert.equal(reads, 0);
    const response = await server.inject('/workspaces/allowed/sessions/session/history');
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().sessionId, 'session');
    assert.equal(reads, 1);
  } finally {
    await server.close();
  }
});
