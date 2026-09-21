/**
 * @author Codex
 * @description Verifies Fastify owns one shared Session Runtime decorator and closes it exactly once.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { sessionRuntimePlugin } from '../dist/plugins/session-runtime.plugin.js';

test('Session Runtime plugin publishes one Coordinator to descendant routes and owns shutdown', async () => {
  const server = Fastify();
  let closeCount = 0;
  const runtime = {
    close: async () => {
      closeCount += 1;
    },
  };
  server.register(sessionRuntimePlugin, { runtime });
  server.register(async (api) => {
    api.get('/runtime', async () => ({ shared: api.sessionRuntime === runtime }));
  });

  const response = await server.inject({ method: 'GET', url: '/runtime' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { shared: true });
  assert.equal(server.sessionRuntime, runtime);
  assert.equal(closeCount, 0);

  await server.close();
  assert.equal(closeCount, 1);
});

test('Session Runtime plugin rejects duplicate registration in one Fastify scope', async () => {
  const server = Fastify();
  const runtime = { close: async () => undefined };
  server.register(sessionRuntimePlugin, { runtime });
  server.register(sessionRuntimePlugin, { runtime });

  await assert.rejects(
    server.ready(),
    /Session Runtime plugin must be registered exactly once per Fastify instance\./
  );
});
