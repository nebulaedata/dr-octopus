/**
 * @author Codex
 * @description Verifies manual Pi associations, per-model protocols and removal of editable capability flags.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { readBuiltinModelCatalog } from '../dist/infrastructure/pi-settings/model-adaptation.js';
import { createPiSettingsStore } from '../dist/infrastructure/pi-settings/index.js';
import { saveCustomProvider } from '../dist/infrastructure/pi-settings/custom-provider-repository.js';
import { SettingsService } from '../dist/modules/model-settings/model-settings.service.js';
import { registerSettingsController } from '../dist/modules/model-settings/model-settings.controller.js';

test('relay corrections inherit native capabilities, survive refresh and can return to automatic matching', async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), 'octopus-association-'));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  const path = join(agentDir, 'models.json');
  const id = 'test-relay';
  const record = {
    runtime: 'mr-token',
    name: 'Relay',
    baseUrl: 'https://relay.invalid/v1',
  };
  await saveCustomProvider(path, id, record, [{ id: 'relay-qwen-alias' }]);
  const service = new SettingsService(createPiSettingsStore({ agentDir }));
  const provider = (await service.listProviders()).providers.find((p) => p.providerId === id);
  const initial = await service.getProvider(provider.providerKey);
  const model = initial.models[0];
  const app = Fastify();
  registerSettingsController(app, service);
  t.after(() => app.close());
  const url = `/settings/model-providers/${provider.providerKey}/models/${model.modelKey}/association`;
  const source = { providerId: 'qwen-token-plan', modelId: 'qwen3.8-max' };
  const candidates = (
    await app.inject(`/settings/model-providers/${provider.providerKey}/associations`)
  ).json().candidates;
  assert.ok(
    candidates.some(
      (candidate) => candidate.providerId === source.providerId && candidate.modelId === source.modelId
    )
  );
  assert.ok(
    candidates.some((candidate) => candidate.providerId === 'xai' && candidate.modelId === 'grok-4.6')
  );
  assert.equal(model.available, false);
  const corrected = await app.inject({ method: 'PUT', url, payload: { source } });
  assert.equal(corrected.statusCode, 200, corrected.body);
  assert.deepEqual(corrected.json().models[0].association, source);
  assert.equal(corrected.json().models[0].adaptation.status, 'adapted');
  await saveCustomProvider(path, id, record, [{ id: 'relay-qwen-alias' }]);
  const reloaded = new SettingsService(createPiSettingsStore({ agentDir }));
  assert.deepEqual((await reloaded.getProvider(provider.providerKey)).models[0].association, source);
  const stored = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(
    stored.providers[id].models[0].id,
    'relay-qwen-alias',
    'wire model ID must remain the relay ID'
  );
  assert.equal(stored.providers[id].models[0].compat.supportsDeveloperRole, false);
  assert.equal(
    (await app.inject({ method: 'PUT', url, payload: { source, reasoning: false } })).statusCode,
    400
  );
  const grok = await app.inject({
    method: 'PUT',
    url,
    payload: { source: { providerId: 'xai', modelId: 'grok-4.6' } },
  });
  assert.equal(grok.statusCode, 200, grok.body);
  assert.equal(grok.json().models[0].api, 'openai-responses');
  const grokDocument = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(grokDocument.providers[id].api, undefined);
  assert.equal(grokDocument.octopusLocalProviders[id].api, undefined);
  assert.equal(grokDocument.providers[id].models[0].id, 'relay-qwen-alias');
  assert.equal(grokDocument.providers[id].models[0].api, 'openai-responses');
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: url.replace('/association', '/configuration'),
        payload: { reasoning: true, interfaces: ['image'] },
      })
    ).statusCode,
    404
  );
  const reset = await app.inject({ method: 'PUT', url, payload: { source: null } });
  assert.equal(reset.json().models[0].adaptation.status, 'unadapted');
  assert.equal(reset.json().models[0].association, null);
  assert.equal(reset.json().models[0].interfaces, undefined);
});

test('one relay inherits Completions, Responses and Anthropic protocols without a provider API', async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), 'octopus-mixed-protocols-'));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  const path = join(agentDir, 'models.json');
  const native = readBuiltinModelCatalog();
  const claude = native.find((model) => model.provider === 'anthropic');
  const ids = ['qwen3.8-max', 'grok-4.6', claude.id];
  await saveCustomProvider(
    path,
    'relay',
    { name: 'Relay', runtime: 'mr-token', baseUrl: 'https://relay.invalid/v1' },
    ids.map((id) => ({ id }))
  );
  const runtime = await ModelRuntime.create({
    modelsPath: path,
    authPath: join(agentDir, 'auth.json'),
    allowModelNetwork: false,
  });
  assert.equal(runtime.getError(), undefined);
  assert.equal(runtime.getModel('relay', ids[0]).api, 'openai-completions');
  assert.equal(runtime.getModel('relay', ids[1]).api, 'openai-responses');
  assert.equal(runtime.getModel('relay', ids[2]).api, claude.api);
  for (const id of ids) assert.equal(runtime.getModel('relay', id).baseUrl, 'https://relay.invalid/v1');
  const document = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(document.providers.relay.api, undefined);
  assert.equal(document.octopusLocalProviders.relay.api, undefined);
});

test('unknown local models remain usable and do not expose image-only models or configuration flags', async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), 'octopus-local-catalog-'));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  await saveCustomProvider(
    join(agentDir, 'models.json'),
    'local',
    { runtime: 'vllm', name: 'Local', baseUrl: 'http://localhost:8000' },
    [{ id: 'my-local-model' }]
  );
  const service = new SettingsService(createPiSettingsStore({ agentDir }));
  const providers = (await service.listProviders()).providers;
  const local = await service.getProvider(providers.find((p) => p.providerId === 'local').providerKey);
  assert.equal(local.models[0].available, true);
  assert.equal(local.models[0].interfaces, undefined);
  await assert.rejects(service.listModelAssociations(local.providerKey), {
    code: 'MODEL_PROVIDER_CAPABILITY_UNSUPPORTED',
  });
  const openai = await service.getProvider(providers.find((p) => p.providerId === 'openai').providerKey);
  assert.equal(
    openai.models.some((m) => m.modelId === 'gpt-image-1'),
    false
  );
});
