/**
 * @author Codex
 * @description Verifies secret-safe Provider authentication session prompts, conflicts, and terminal outcomes.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PiCredentialSynchronizationError } from '../dist/infrastructure/pi-settings/index.js';
import { ProviderAuthSessionManager } from '../dist/modules/provider-auth/provider-auth.service.js';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const PROMPT_ID = '22222222-2222-4222-8222-222222222222';

test('credential commits are reported once even when cancellation wins the UI transition', async () => {
  for (const synchronizationFailed of [false, true]) {
    const completion = Promise.withResolvers();
    let commits = 0;
    const manager = new ProviderAuthSessionManager(
      { loginProvider: () => completion.promise },
      {
        createId: () => SESSION_ID,
        modelConfigChanges: { recordCommitted: () => commits++ },
      }
    );
    try {
      manager.create('provider-key', 'provider-a', 'oauth');
      manager.cancel('provider-key', SESSION_ID);
      if (synchronizationFailed) {
        completion.reject(new PiCredentialSynchronizationError('login'));
      } else {
        completion.resolve();
      }
      await settleBackgroundTask();
      assert.equal(commits, 1);
      assert.equal(manager.get('provider-key', SESSION_ID).status, 'cancelled');
    } finally {
      await manager.close();
    }
  }
});

/**
 * Waits for background login settlement after an answer resolves its pending prompt.
 */
function settleBackgroundTask() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('API Key answers are never retained in authentication snapshots', async () => {
  const ids = [SESSION_ID, PROMPT_ID];
  let receivedAnswer;
  let notifications = 0;
  const settings = {
    async loginProvider(_providerId, _type, interaction) {
      interaction.notify({ type: 'progress', message: 'Waiting for key' });
      receivedAnswer = await interaction.prompt({ type: 'secret', message: 'API Key' });
    },
  };
  const manager = new ProviderAuthSessionManager(settings, {
    createId: () => ids.shift(),
    onChanged: () => notifications++,
  });
  try {
    const created = manager.create('provider-key', 'provider-a', 'api_key');
    assert.equal(created.status, 'awaiting_input');
    assert.equal(created.prompt.type, 'secret');
    assert.equal(created.events[0].type, 'progress');

    const answered = manager.answer('provider-key', SESSION_ID, PROMPT_ID, 'top-secret-value');
    assert.equal(JSON.stringify(answered).includes('top-secret-value'), false);
    await settleBackgroundTask();

    const completed = manager.get('provider-key', SESSION_ID);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.result.credentialCommitted, true);
    assert.ok(notifications >= 2, 'prompt and terminal transitions must emit changes');
    assert.equal(receivedAnswer, 'top-secret-value');
  } finally {
    await manager.close();
  }
});

test('sessions reject Provider conflicts and invalid select answers', async () => {
  const ids = [SESSION_ID, PROMPT_ID];
  const settings = {
    async loginProvider(_providerId, _type, interaction) {
      await interaction.prompt({
        type: 'select',
        message: 'Account',
        options: [{ id: 'personal', label: 'Personal' }],
      });
    },
  };
  const manager = new ProviderAuthSessionManager(settings, {
    createId: () => ids.shift(),
  });
  try {
    manager.create('provider-key', 'provider-a', 'oauth');
    assert.throws(
      () => manager.create('provider-key', 'provider-a', 'oauth'),
      (error) => error.code === 'MODEL_PROVIDER_AUTH_SESSION_CONFLICT'
    );
    assert.throws(
      () => manager.answer('provider-key', SESSION_ID, PROMPT_ID, 'unknown'),
      (error) => error.code === 'MODEL_PROVIDER_AUTH_ANSWER_INVALID'
    );
    assert.equal(manager.cancel('provider-key', SESSION_ID).status, 'cancelled');
    assert.equal(manager.cancel('provider-key', SESSION_ID), undefined);
  } finally {
    await manager.close();
  }
});

test('committed credentials retain partial-success synchronization semantics', async () => {
  const manager = new ProviderAuthSessionManager(
    {
      async loginProvider() {
        throw new PiCredentialSynchronizationError('login');
      },
    },
    { createId: () => SESSION_ID }
  );
  try {
    manager.create('provider-key', 'provider-a', 'api_key');
    await settleBackgroundTask();
    const snapshot = manager.get('provider-key', SESSION_ID);
    assert.equal(snapshot.status, 'committed_but_unsynced');
    assert.deepEqual(snapshot.result, {
      credentialCommitted: true,
      providerSnapshotSynchronized: false,
      nextAction: 'refresh_provider',
    });
  } finally {
    await manager.close();
  }
});
