/**
 * @author Codex
 * @description Verifies capability HTTP validation, Pi thinking levels, atomic persistence and local-model resaves.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { createPiSettingsStore } from '../dist/infrastructure/pi-settings/index.js';
import {
  saveCustomProvider,
  saveModelConfiguration,
} from '../dist/infrastructure/pi-settings/custom-provider-repository.js';
import { SettingsService } from '../dist/modules/model-settings/model-settings.service.js';
import { ConversationModelsService } from '../dist/modules/conversation-start/conversation-start.service.js';
import { registerSettingsController } from '../dist/modules/model-settings/model-settings.controller.js';

test('custom interfaces survive reload, filter agent candidates and reject image-only admission', async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), 'octopus-interfaces-'));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  const path = join(agentDir, 'models.json');
  await writeFile(
    path,
    JSON.stringify({
      providers: {
        custom: {
          api: 'openai-completions',
          baseUrl: 'https://example.test/v1',
          apiKey: 'test-key',
          models: [{ id: 'arbitrary-name' }, { id: 'legacy-chat' }],
        },
      },
    })
  );
  const service = new SettingsService(createPiSettingsStore({ agentDir }));
  const provider = (await service.listProviders()).providers.find((p) => p.providerId === 'custom');
  const detail = await service.getProvider(provider.providerKey);
  const model = detail.models.find((m) => m.modelId === 'arbitrary-name');
  const capabilities = { reasoning: false, input: ['text'], imageGeneration: true };
  const app = Fastify();
  t.after(() => app.close());
  registerSettingsController(app, service);
  const url = `/settings/model-providers/${provider.providerKey}/models/${model.modelKey}/configuration`;
  for (const interfaces of [
    [],
    ['video'],
    ['chat', 'chat'],
    ['chat', 'other'],
    ['image', 'other'],
    'image',
  ]) {
    assert.equal(
      (await app.inject({ method: 'PUT', url, payload: { ...capabilities, interfaces } })).statusCode,
      400
    );
  }
  await service.setDefaultModel(provider.providerKey, model.modelKey);
  assert.equal(
    (await app.inject({ method: 'PUT', url, payload: { ...capabilities, interfaces: ['image'] } }))
      .statusCode,
    200
  );
  const reloaded = new SettingsService(createPiSettingsStore({ agentDir }));
  const restored = await reloaded.getProvider(provider.providerKey);
  assert.deepEqual(restored.models.find((m) => m.modelId === model.modelId).interfaces, ['image']);
  assert.deepEqual(restored.models.find((m) => m.modelId === 'legacy-chat').interfaces, ['chat']);
  assert.equal((await reloaded.getDefaultModel()).available, false);
  assert.equal(
    (await reloaded.listDefaultModelCandidates()).candidates.some((m) => m.modelId === model.modelId),
    false
  );
  await assert.rejects(reloaded.setDefaultModel(provider.providerKey, model.modelKey));
  const admission = new ConversationModelsService(reloaded, async () => 'version');
  await assert.rejects(admission.resolve({ mode: 'explicit', provider: 'custom', modelId: model.modelId }), {
    code: 'CONVERSATION_MODEL_REQUIRED',
  });
  await assert.rejects(admission.resolve({ mode: 'default' }), { code: 'CONVERSATION_MODEL_REQUIRED' });
  // Older clients can update other capabilities without erasing the configured interface.
  await reloaded.updateModelConfiguration(provider.providerKey, model.modelKey, capabilities);
  assert.deepEqual(
    (await reloaded.getProvider(provider.providerKey)).models.find((m) => m.modelId === model.modelId)
      .interfaces,
    ['image']
  );
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url,
        payload: { ...capabilities, interfaces: ['image'], contextWindow: 1000000, maxTokens: 32768 },
      })
    ).statusCode,
    422
  );
  const chatConfiguration = await app.inject({
    method: 'PUT',
    url,
    payload: { ...capabilities, interfaces: ['chat', 'image'], contextWindow: 1000000, maxTokens: 32768 },
  });
  assert.equal(chatConfiguration.statusCode, 200, chatConfiguration.body);
  assert.equal(chatConfiguration.json().models[0].contextWindow, 1000000);
  assert.equal(chatConfiguration.json().models[0].maxTokens, 32768);
  for (const interfaces of [['chat', 'image'], ['chat']]) {
    await reloaded.updateModelConfiguration(provider.providerKey, model.modelKey, {
      ...capabilities,
      interfaces,
    });
    assert.equal(
      (await admission.resolve({ mode: 'explicit', provider: 'custom', modelId: model.modelId })).id,
      model.modelId
    );
  }
  assert.equal(
    (await app.inject({ method: 'PUT', url, payload: { ...capabilities, interfaces: ['other'] } }))
      .statusCode,
    200
  );
  const otherService = new SettingsService(createPiSettingsStore({ agentDir }));
  assert.deepEqual(
    (await otherService.getProvider(provider.providerKey)).models.find((m) => m.modelId === model.modelId)
      .interfaces,
    ['other']
  );
  assert.equal((await otherService.getDefaultModel()).available, false);
  assert.equal(
    (await otherService.listDefaultModelCandidates()).candidates.some((m) => m.modelId === model.modelId),
    false
  );
  await assert.rejects(otherService.setDefaultModel(provider.providerKey, model.modelKey));
  const otherAdmission = new ConversationModelsService(otherService, async () => 'version');
  await assert.rejects(
    otherAdmission.resolve({ mode: 'explicit', provider: 'custom', modelId: model.modelId }),
    { code: 'CONVERSATION_MODEL_REQUIRED' }
  );
  const document = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(
    document.providers.custom.models[0].interfaces,
    undefined,
    'Host metadata must not leak into Pi configuration'
  );
  assert.deepEqual(document.octopusModelCapabilities.custom[model.modelId].interfaces, ['other']);
});

test('custom model capability edits survive reload and unlock Pi thinking levels', async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), 'octopus-capabilities-'));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  const path = join(agentDir, 'models.json');
  const provider = {
    api: 'openai-completions',
    baseUrl: 'http://localhost:1234/v1',
    apiKey: 'test-key',
    modelOverrides: { 'custom-model': { reasoning: false, input: ['text'], maxTokens: 2048 } },
    models: [
      {
        id: 'custom-model',
        reasoning: false,
        input: ['text'],
        contextWindow: 32000,
        maxTokens: 4096,
        compat: { thinkingFormat: 'qwen' },
      },
      { id: 'other-model' },
    ],
  };
  await writeFile(path, JSON.stringify({ providers: { custom: provider }, unrelated: { preserve: true } }));
  const store = createPiSettingsStore({ agentDir });
  let commits = 0;
  const service = new SettingsService(store, {
    recordCommitted() {
      commits++;
    },
  });
  const app = Fastify();
  t.after(() => app.close());
  registerSettingsController(app, service);
  const summary = (await service.listProviders()).providers.find((p) => p.providerId === 'custom');
  const detail = await service.getProvider(summary.providerKey);
  const model = detail.models.find((m) => m.modelId === 'custom-model');
  const url = `/settings/model-providers/${summary.providerKey}/models/${model.modelKey}/configuration`;
  for (const payload of [
    { reasoning: 'true', input: ['text'] },
    { reasoning: true, input: [] },
    { reasoning: true, input: ['audio'] },
    { reasoning: true, input: ['text'], tasks: ['unsupported'] },
    { reasoning: true, input: ['text'], imageGeneration: true, tasks: ['reranking'] },
    { reasoning: true, input: ['text'], imageGeneration: true, tasks: ['embedding'] },
  ]) {
    assert.equal((await app.inject({ method: 'PUT', url, payload })).statusCode, 400);
  }
  const payload = { reasoning: true, input: ['text', 'image'], imageGeneration: false };
  const response = await app.inject({ method: 'PUT', url, payload });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().models[0].reasoning, true);
  assert.equal(commits, 1);
  await app.inject({ method: 'PUT', url, payload });
  assert.equal(commits, 1, 'identical edits must not restart sessions again');
  const labeled = await app.inject({
    method: 'PUT',
    url,
    payload: { ...payload, imageGeneration: true },
  });
  assert.deepEqual(labeled.json().models[0].capabilities, ['reasoning', 'image_input', 'image_generation']);
  assert.equal(commits, 1, 'the image marker must not restart sessions');
  const document = JSON.parse(await readFile(path, 'utf8'));
  assert.deepEqual(document.unrelated, { preserve: true });
  assert.equal(document.providers.custom.apiKey, provider.apiKey);
  assert.deepEqual(document.providers.custom.models[1], provider.models[1]);
  assert.deepEqual(document.providers.custom.models[0].compat, { thinkingFormat: 'qwen' });
  assert.equal(document.providers.custom.models[0].imageGeneration, undefined);
  assert.deepEqual(document.octopusModelCapabilities.custom['custom-model'], { imageGeneration: true });
  const reloadedService = new SettingsService(createPiSettingsStore({ agentDir }));
  const reloadedDetail = await reloadedService.getProvider(summary.providerKey);
  assert.deepEqual(reloadedDetail.models[0].capabilities, ['reasoning', 'image_input', 'image_generation']);
  const cleared = await app.inject({ method: 'PUT', url, payload });
  assert.deepEqual(cleared.json().models[0].capabilities, ['reasoning', 'image_input']);
  assert.equal(commits, 1, 'clearing the image marker must not restart sessions');
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')).octopusModelCapabilities.custom, {
    'custom-model': { imageGeneration: false },
  });
  const runtime = await ModelRuntime.create({
    modelsPath: path,
    authPath: join(agentDir, 'auth.json'),
    allowModelNetwork: false,
  });
  const reloaded = runtime.getModel('custom', 'custom-model');
  assert.deepEqual(reloaded.input, ['text', 'image']);
  assert.equal(reloaded.maxTokens, 2048);
  assert.ok(getSupportedThinkingLevels(reloaded).includes('high'));
  await app.inject({
    method: 'PUT',
    url,
    payload: { reasoning: false, input: ['text'], imageGeneration: false },
  });
  await runtime.refresh({ providers: ['custom'], allowNetwork: false });
  assert.deepEqual(getSupportedThinkingLevels(runtime.getModel('custom', 'custom-model')), ['off']);
  await assert.rejects(service.updateModelConfiguration(summary.providerKey, 'missing', payload));
  const builtin = (await service.listProviders()).providers.find(
    (p) => p.provenance === 'builtin' && p.modelCount > 0
  );
  const builtinDetail = await service.getProvider(builtin.providerKey);
  await assert.rejects(
    service.updateModelConfiguration(builtin.providerKey, builtinDetail.models[0].modelKey, payload)
  );
});

test('custom model token limits replace Pi defaults and survive rediscovery', async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), 'octopus-model-limits-'));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  const path = join(agentDir, 'models.json');
  const record = {
    name: 'Remote models',
    runtime: 'openai-compatible',
    baseUrl: 'https://example.test/v1',
    api: 'openai-completions',
  };
  await saveCustomProvider(path, 'custom', record, [{ id: 'large' }, { id: 'small' }]);
  const service = new SettingsService(createPiSettingsStore({ agentDir }));
  const provider = (await service.listProviders()).providers.find((item) => item.providerId === 'custom');
  const initial = await service.getProvider(provider.providerKey);
  const model = initial.models.find((item) => item.modelId === 'large');
  assert.equal(model.contextWindow, 128000);
  assert.equal(model.maxTokens, 16384);
  assert.equal(model.contextWindowConfigured, false);
  assert.equal(model.maxTokensConfigured, false);

  const app = Fastify();
  t.after(() => app.close());
  registerSettingsController(app, service);
  const url = `/settings/model-providers/${provider.providerKey}/models/${model.modelKey}/configuration`;
  const capabilities = { reasoning: false, input: ['text'], imageGeneration: false };
  const capabilityOnly = await app.inject({ method: 'PUT', url, payload: capabilities });
  assert.equal(capabilityOnly.statusCode, 200);
  assert.equal(capabilityOnly.json().models[0].contextWindowConfigured, false);
  assert.equal(JSON.parse(await readFile(path, 'utf8')).providers.custom.models[0].contextWindow, undefined);
  for (const limits of [
    { contextWindow: 0, maxTokens: 32768 },
    { contextWindow: 1.5, maxTokens: 1 },
    { contextWindow: 1000000, maxTokens: 1000000 },
  ]) {
    const response = await app.inject({ method: 'PUT', url, payload: { ...capabilities, ...limits } });
    assert.ok([400, 422].includes(response.statusCode));
  }
  const response = await app.inject({
    method: 'PUT',
    url,
    payload: { ...capabilities, contextWindow: 1000000, maxTokens: 32768 },
  });
  assert.equal(response.statusCode, 200, response.body);
  const configured = response.json().models.find((item) => item.modelId === 'large');
  assert.equal(configured.contextWindow, 1000000);
  assert.equal(configured.maxTokens, 32768);
  assert.equal(configured.contextWindowConfigured, true);
  assert.equal(configured.maxTokensConfigured, true);
  const saved = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(saved.providers.custom.models[0].contextWindow, 1000000);
  assert.equal(saved.providers.custom.models[0].maxTokens, 32768);
  assert.equal(saved.providers.custom.models[1].contextWindow, undefined);

  await saveCustomProvider(path, 'custom', record, [{ id: 'large' }, { id: 'new' }]);
  const restored = await new SettingsService(createPiSettingsStore({ agentDir })).getProvider(
    provider.providerKey
  );
  assert.equal(restored.models[0].contextWindow, 1000000);
  assert.equal(restored.models[0].maxTokens, 32768);
  assert.equal(restored.models[1].contextWindowConfigured, false);
  const runtime = await ModelRuntime.create({
    modelsPath: path,
    authPath: join(agentDir, 'auth.json'),
    allowModelNetwork: false,
  });
  assert.equal(runtime.getModel('custom', 'large').contextWindow, 1000000);
  assert.equal(runtime.getModel('custom', 'large').maxTokens, 32768);
});

test('built-in image models share the provider list without becoming chat defaults', async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), 'octopus-image-catalog-'));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  const service = new SettingsService(createPiSettingsStore({ agentDir }));
  const catalog = await service.listProviders();
  const openrouter = catalog.providers.find((provider) => provider.providerId === 'openrouter');
  const detail = await service.getProvider(openrouter.providerKey);
  const imageOnly = detail.models.find((model) => model.modelId === 'openai/gpt-image-1');
  assert.deepEqual(imageOnly.interfaces, ['image']);
  assert.ok(imageOnly.capabilities.includes('image_generation'));
  assert.equal(imageOnly.contextWindow, undefined);
  assert.equal(imageOnly.maxTokens, undefined);
  assert.equal(detail.models.filter((model) => model.modelId === 'google/gemini-3-pro-image').length, 1);
  assert.deepEqual(detail.models.find((model) => model.modelId === 'google/gemini-3-pro-image').interfaces, [
    'chat',
    'image',
  ]);
  assert.ok(detail.modelCount > 366);
  const deepseek = catalog.providers.find((provider) => provider.providerId === 'deepseek');
  const deepseekDetail = await service.getProvider(deepseek.providerKey);
  assert.ok(deepseekDetail.models.every((model) => !model.capabilities.includes('image_generation')));
  const candidates = await service.listDefaultModelCandidates();
  assert.ok(
    candidates.candidates.every(
      (model) => model.modelId !== imageOnly.modelId || model.providerId !== 'openrouter'
    )
  );
  await assert.rejects(service.setDefaultModel(openrouter.providerKey, imageOnly.modelKey));
});

test('local endpoint resaves preserve edited model capabilities and concurrent edits', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'octopus-capabilities-local-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'models.json');
  const record = { name: 'Local', runtime: 'vllm', baseUrl: 'http://localhost:8000', modelId: 'local-model' };
  await saveCustomProvider(path, 'local', record);
  await saveCustomProvider(path, 'other', { ...record, modelId: 'other-model' });
  await Promise.all([
    saveModelConfiguration(path, 'local', record.modelId, {
      reasoning: true,
      input: ['text', 'image'],
      imageGeneration: false,
    }),
    saveModelConfiguration(path, 'other', 'other-model', {
      reasoning: true,
      input: ['text'],
      imageGeneration: false,
    }),
  ]);
  await saveCustomProvider(path, 'local', { ...record, baseUrl: 'http://localhost:8001' });
  const document = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(document.providers.local.models[0].reasoning, true);
  assert.deepEqual(document.providers.local.models[0].input, ['text', 'image']);
  assert.equal(document.providers.local.models[0].compat.supportsReasoningEffort, true);
  assert.equal(document.providers.other.models[0].reasoning, true);
});

for (const withOverrides of [false, true]) {
  test(`inherited model image capabilities persist without explicit models (overrides: ${withOverrides})`, async (t) => {
    const agentDir = await mkdtemp(join(tmpdir(), 'octopus-inherited-capabilities-'));
    t.after(() => rm(agentDir, { recursive: true, force: true }));
    const path = join(agentDir, 'models.json');
    await writeFile(
      path,
      JSON.stringify({
        providers: {
          openai: {
            baseUrl: 'https://example.test/v1',
            ...(withOverrides ? { modelOverrides: { 'gpt-4': { reasoning: false } } } : {}),
          },
        },
      })
    );
    const service = new SettingsService(createPiSettingsStore({ agentDir }));
    const provider = (await service.listProviders()).providers.find((item) => item.providerId === 'openai');
    const detail = await service.getProvider(provider.providerKey);
    const model = detail.models.find((item) => item.modelId === 'gpt-4');
    const capabilities = {
      reasoning: model.reasoning,
      input: model.input,
      imageGeneration: true,
      contextWindow: 1000000,
      maxTokens: 32768,
    };
    const saved = await service.updateModelConfiguration(provider.providerKey, model.modelKey, capabilities);
    assert.ok(
      saved.models.find((item) => item.modelId === model.modelId).capabilities.includes('image_generation')
    );
    const reloaded = new SettingsService(createPiSettingsStore({ agentDir }));
    const restored = await reloaded.getProvider(provider.providerKey);
    assert.ok(
      restored.models.find((item) => item.modelId === model.modelId).capabilities.includes('image_generation')
    );
    assert.equal(restored.models.find((item) => item.modelId === model.modelId).contextWindow, 1000000);
    assert.equal(restored.models.find((item) => item.modelId === model.modelId).maxTokens, 32768);
    assert.equal(
      restored.models.find((item) => item.modelId === model.modelId).contextWindowConfigured,
      true
    );
    assert.equal(restored.models.find((item) => item.modelId === model.modelId).maxTokensConfigured, true);
    const cleared = await reloaded.updateModelConfiguration(provider.providerKey, model.modelKey, {
      ...capabilities,
      imageGeneration: false,
    });
    assert.equal(
      cleared.models.find((item) => item.modelId === model.modelId).capabilities.includes('image_generation'),
      false
    );
    const document = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(document.providers.openai.models, undefined);
    assert.equal(document.providers.openai.modelOverrides[model.modelId].contextWindow, 1000000);
    assert.equal(document.providers.openai.modelOverrides[model.modelId].maxTokens, 32768);
    assert.deepEqual(document.octopusModelCapabilities.openai, {
      [model.modelId]: { imageGeneration: false },
    });
  });
}
