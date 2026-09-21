/**
 * @author Codex
 * @description Verifies Settings authentication route schemas, idempotency headers, and HTTP status contracts.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerSettingsController } from '../dist/modules/settings/settings.controller.js';

const IDEMPOTENCY_KEY = '33333333-3333-4333-8333-333333333333';
const RESET_IDEMPOTENCY_KEY = '44444444-4444-4444-8444-444444444444';
const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const PROMPT_ID = '22222222-2222-4222-8222-222222222222';

/**
 * Creates a minimal Settings route double focused on authentication transport behavior.
 */
function createSettingsService() {
  const snapshot = {
    id: SESSION_ID,
    providerKey: 'provider-key',
    providerId: 'provider-a',
    authType: 'api_key',
    status: 'running',
    revision: 1,
    createdAt: new Date(0).toISOString(),
    expiresAt: new Date(60_000).toISOString(),
    events: [],
  };
  const service = {
    resetCalls: 0,
    listProviders: async () => ({ providers: [] }),
    getProvider: async () => undefined,
    getDefaultModel: async () => ({}),
    listDefaultModelCandidates: async () => ({ candidates: [] }),
    setDefaultModel: async () => ({}),
    createProviderAuthSession: async () => snapshot,
    getProviderAuthSession: () => snapshot,
    answerProviderAuthPrompt: () => ({ ...snapshot, status: 'completed', revision: 2 }),
    cancelProviderAuthSession: () => ({ ...snapshot, status: 'cancelled', revision: 2 }),
    async resetProviderAuth() {
      service.resetCalls += 1;
      return {
        credentialRemoved: true,
        providerSnapshotSynchronized: true,
        nextAction: 'none',
      };
    },
  };
  return service;
}

test('authentication routes enforce mutation identity and return asynchronous snapshots', async () => {
  const server = Fastify();
  const service = createSettingsService();
  registerSettingsController(server, service);
  try {
    const missingKey = await server.inject({
      method: 'POST',
      url: '/settings/model-providers/provider-key/auth-sessions',
      payload: { type: 'api_key' },
    });
    assert.equal(missingKey.statusCode, 400);

    const created = await server.inject({
      method: 'POST',
      url: '/settings/model-providers/provider-key/auth-sessions',
      headers: { 'idempotency-key': IDEMPOTENCY_KEY },
      payload: { type: 'api_key' },
    });
    assert.equal(created.statusCode, 202);
    assert.equal(created.json().id, SESSION_ID);

    const answered = await server.inject({
      method: 'POST',
      url: `/settings/model-providers/provider-key/auth-sessions/${SESSION_ID}/answers`,
      payload: { promptId: PROMPT_ID, answer: 'write-only' },
    });
    assert.equal(answered.statusCode, 202);
    assert.equal(answered.json().status, 'completed');

    const cancelled = await server.inject({
      method: 'DELETE',
      url: `/settings/model-providers/provider-key/auth-sessions/${SESSION_ID}`,
      headers: { 'idempotency-key': IDEMPOTENCY_KEY },
    });
    assert.equal(cancelled.statusCode, 202);

    const reset = await server.inject({
      method: 'DELETE',
      url: '/settings/model-providers/provider-key/auth',
      headers: { 'idempotency-key': RESET_IDEMPOTENCY_KEY },
    });
    assert.equal(reset.statusCode, 200);
    assert.equal(reset.json().credentialRemoved, true);

    const replayedReset = await server.inject({
      method: 'DELETE',
      url: '/settings/model-providers/provider-key/auth',
      headers: { 'idempotency-key': RESET_IDEMPOTENCY_KEY },
    });
    assert.equal(replayedReset.statusCode, 200);
    assert.equal(service.resetCalls, 1);
  } finally {
    await server.close();
  }
});
