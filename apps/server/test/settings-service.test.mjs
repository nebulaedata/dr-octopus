/**
 * @author Codex
 * @description Verifies opaque Settings identities and default-model mapping at the Server boundary.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { SettingsService } from '../dist/modules/settings/settings.service.js';

test('model commits notify before a refresh failure is returned; unchanged and failed saves do not notify', async () => {
  const fixture = createPiSettingsFixture();
  let result = { changed: false, synchronized: true };
  let commits = 0;
  fixture.piSettings.configureLocalProvider = async () => {
    if (result instanceof Error) {
      throw result;
    }
    return result;
  };
  const service = new SettingsService(fixture.piSettings, { recordCommitted: () => commits++ });
  try {
    const key = (await service.listProviders()).providers[0].providerKey;
    await service.configureLocalProvider(key, {});
    assert.equal(commits, 0);
    result = { changed: true, synchronized: false };
    await assert.rejects(service.configureLocalProvider(key, {}), {
      code: 'MODEL_CONFIG_COMMITTED_UNSYNCED',
    });
    assert.equal(commits, 1);
    result = new Error('save failed');
    await assert.rejects(service.configureLocalProvider(key, {}), /save failed/);
    assert.equal(commits, 1);
    const candidates = await service.listDefaultModelCandidates();
    await service.setDefaultModel(key, candidates.candidates[0].modelKey);
    assert.equal(commits, 1);
  } finally {
    await service.close();
  }
});

/**
 * Creates a deterministic Pi settings store double and captures default-model writes.
 *
 * @returns Pi settings store fixture and its write ledger.
 */
function createPiSettingsFixture() {
  const writes = [];
  const logoutWrites = [];
  let defaultModel = { providerId: 'provider-a', modelId: 'model-a' };
  const providers = [
    {
      id: 'provider-a',
      name: 'Provider A',
      baseUrl: 'https://example.invalid',
      provenance: 'builtin',
      auth: { configured: true, methods: ['api_key'], source: 'stored' },
      refreshable: false,
      endpointOwned: false,
      models: [
        {
          id: 'model-a',
          name: 'Model A',
          api: 'openai-completions',
          baseUrl: 'https://example.invalid',
          reasoning: true,
          input: ['text'],
          contextWindow: 128_000,
          maxTokens: 8_192,
          available: true,
          configuration: 'inherited',
        },
      ],
    },
  ];
  return {
    writes,
    logoutWrites,
    providers,
    piSettings: {
      async listProviders() {
        return providers;
      },
      async getDefaultModel() {
        return defaultModel;
      },
      async setDefaultModel(providerId, modelId) {
        defaultModel = { providerId, modelId };
        writes.push(defaultModel);
        return defaultModel;
      },
      async logoutProvider(providerId) {
        logoutWrites.push(providerId);
        providers[0].auth = { configured: false, methods: ['api_key'] };
      },
    },
  };
}

test('SettingsService keeps route identities opaque and maps the Pi default pair', async () => {
  const fixture = createPiSettingsFixture();
  const service = new SettingsService(fixture.piSettings);

  const catalog = await service.listProviders();
  const provider = catalog.providers[0];
  assert.ok(provider.providerKey.startsWith('p1_'));
  assert.notEqual(provider.providerKey, provider.providerId);
  assert.equal(provider.defaultModelId, 'model-a');

  const detail = await service.getProvider(provider.providerKey);
  assert.equal(detail.endpoint.effectiveBaseUrl, 'https://example.invalid');
  assert.equal(detail.models[0].isDefault, true);

  const candidates = await service.listDefaultModelCandidates();
  assert.equal(candidates.candidates.length, 1);
  assert.notEqual(candidates.candidates[0].modelKey, 'model-a');

  const updated = await service.setDefaultModel(provider.providerKey, candidates.candidates[0].modelKey);
  assert.deepEqual(fixture.writes, [{ providerId: 'provider-a', modelId: 'model-a' }]);
  assert.equal(updated.available, true);
});

test('SettingsService rejects stale or cross-provider opaque selections', async () => {
  const fixture = createPiSettingsFixture();
  const service = new SettingsService(fixture.piSettings);
  const catalog = await service.listProviders();

  await assert.rejects(
    service.setDefaultModel(catalog.providers[0].providerKey, 'p1_0000000000000000000000'),
    /no longer exists/u
  );
  assert.deepEqual(fixture.writes, []);
});

test('SettingsService resets only credentials stored by the application', async () => {
  const fixture = createPiSettingsFixture();
  const service = new SettingsService(fixture.piSettings);
  const catalog = await service.listProviders();
  const providerKey = catalog.providers[0].providerKey;

  const result = await service.resetProviderAuth(providerKey);
  assert.deepEqual(fixture.logoutWrites, ['provider-a']);
  assert.deepEqual(result, {
    credentialRemoved: true,
    providerSnapshotSynchronized: true,
    nextAction: 'none',
  });

  fixture.providers[0].auth = {
    configured: true,
    methods: ['api_key'],
    source: 'environment',
  };
  await assert.rejects(service.resetProviderAuth(providerKey), (error) => {
    assert.equal(error.code, 'MODEL_PROVIDER_AUTH_RESET_UNSUPPORTED');
    assert.equal(error.statusCode, 422);
    return true;
  });
});
