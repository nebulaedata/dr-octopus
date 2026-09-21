/**
 * @author Codex
 * @description Ensures irreversible archived lifecycle operations require user-control credentials.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { handleSchedulerTaskRequest } from '../dist/extensions/scheduler/daemon/task-routes.js';

test('task credentials cannot restore or purge while user control forwards the revision and key', async (t) => {
  const calls = [];
  const endpoint = { daemonId: 'daemon', profileId: 'profile' };
  const service = {
    mutate(scope, request) {
      calls.push({ scope, request });
      return { effect: request.operation };
    },
  };
  const server = createServer((request, response) => {
    void handleSchedulerTaskRequest(
      request,
      response,
      endpoint,
      'task-token',
      service,
      {},
      undefined,
      'control-token'
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  for (const operation of ['restore', 'purge']) {
    for (const token of ['task-token', 'control-token']) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/scheduler/v1/tasks/request`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'x-scheduler-daemon': 'daemon',
          'x-scheduler-profile': 'profile',
        },
        body: JSON.stringify({
          context: { workspaceId: 'w', cwd: '/workspace', configRevision: '1' },
          request: { operation, taskId: 't', revision: 3, key: operation, input: {} },
        }),
      });
      assert.equal(response.status, token === 'task-token' ? 403 : 200);
      await response.text();
    }
  }
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((call) => call.request.operation),
    ['restore', 'purge']
  );
  assert.ok(calls.every((call) => call.request.revision === 3 && call.scope.workspaceId === 'w'));
});
