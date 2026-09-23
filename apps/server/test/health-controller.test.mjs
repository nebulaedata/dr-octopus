/**
 * @author Codex
 * @description Verifies liveness remains independent while readiness reflects live dependency probes.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { createHealthService } from '../dist/modules/health/index.js';
import { registerHealthController } from '../dist/modules/health/health.controller.js';

const limits = {
  maxAttachmentBytes: 1,
  maxAttachmentsPerMessage: 1,
  maxAttachmentMessageBytes: 1,
  tusChunkBytes: 1,
  maxPromptCharacters: 1,
  maxSubscriptionsPerConnection: 1,
  maxWebSocketMessageBytes: 1,
};

test('Health readiness succeeds only when both live dependency probes succeed', async () => {
  const server = Fastify();
  decorateHealthDependencies(server);
  registerHealthController(server, limits, createHealthService(server));

  const response = await server.inject({ method: 'GET', url: '/ready' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    status: 'ready',
    database: 'ready',
    agentManager: 'ready',
    fileLogging: 'disabled',
  });
  await server.close();
});

test('Health readiness returns 503 and isolates a failed dependency probe', async () => {
  const server = Fastify();
  decorateHealthDependencies(server, {
    queryError: new Error('private database failure'),
  });
  registerHealthController(server, limits, createHealthService(server));

  const health = await server.inject({ method: 'GET', url: '/health' });
  const readiness = await server.inject({ method: 'GET', url: '/ready' });
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), { status: 'ok' });
  assert.equal(readiness.statusCode, 503);
  assert.deepEqual(readiness.json(), {
    status: 'not-ready',
    database: 'unavailable',
    agentManager: 'ready',
    fileLogging: 'disabled',
  });
  assert.doesNotMatch(readiness.body, /private database failure/);
  await server.close();
});

/**
 * Decorates a Fastify test instance with the focused plugin contracts used by health checks.
 *
 * @param {import('fastify').FastifyInstance} server Fastify test instance
 * @param {{ queryError?: Error, acceptingRequests?: boolean, loggingHealth?: { state: 'disabled' | 'healthy' | 'degraded', required: boolean, errorCode?: string } }} [options] Dependency behavior
 */
function decorateHealthDependencies(server, options = {}) {
  server.decorate('database', {
    db: {},
    sqlite: {
      open: true,
      prepare() {
        return {
          get() {
            if (options.queryError !== undefined) {
              throw options.queryError;
            }
            return { value: 1 };
          },
        };
      },
    },
  });
  server.decorate('sessionRuntime', {
    isAcceptingRequests() {
      return options.acceptingRequests ?? true;
    },
  });
  server.decorate('logging', {
    logger: server.log,
    getHealth() {
      return options.loggingHealth ?? { state: 'disabled', required: false };
    },
    async ready() {},
    async close() {},
  });
}

test('Health readiness fails only when degraded file logging is required', async () => {
  const server = Fastify();
  decorateHealthDependencies(server, {
    loggingHealth: { state: 'degraded', required: true, errorCode: 'TEST_FAILURE' },
  });
  registerHealthController(server, limits, createHealthService(server));

  const response = await server.inject({ method: 'GET', url: '/ready' });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), {
    status: 'not-ready',
    database: 'ready',
    agentManager: 'ready',
    fileLogging: 'degraded',
  });
  assert.doesNotMatch(response.body, /TEST_FAILURE/);
  await server.close();
});
