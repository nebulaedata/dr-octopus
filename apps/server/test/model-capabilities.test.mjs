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
  saveLocalProvider,
  saveModelCapabilities,
} from '../dist/infrastructure/pi-settings/local-provider-repository.js';
import { SettingsService } from '../dist/modules/model-settings/model-settings.service.js';
import { registerSettingsController } from '../dist/modules/model-settings/model-settings.controller.js';

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
  const url = `/settings/model-providers/${summary.providerKey}/models/${model.modelKey}/capabilities`;
  for (const payload of [
    { reasoning: 'true', input: ['text'] },
    { reasoning: true, input: [] },
    { reasoning: true, input: ['audio'] },
  ]) {
    assert.equal((await app.inject({ method: 'PUT', url, payload })).statusCode, 400);
  }
  const payload = { reasoning: true, input: ['text', 'image'] };
  const response = await app.inject({ method: 'PUT', url, payload });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().models[0].reasoning, true);
  assert.equal(commits, 1);
  await app.inject({ method: 'PUT', url, payload });
  assert.equal(commits, 1, 'identical edits must not restart sessions again');
  const document = JSON.parse(await readFile(path, 'utf8'));
  assert.deepEqual(document.unrelated, { preserve: true });
  assert.equal(document.providers.custom.apiKey, provider.apiKey);
  assert.deepEqual(document.providers.custom.models[1], provider.models[1]);
  assert.deepEqual(document.providers.custom.models[0].compat, { thinkingFormat: 'qwen' });
  const runtime = await ModelRuntime.create({
    modelsPath: path,
    authPath: join(agentDir, 'auth.json'),
    allowModelNetwork: false,
  });
  const reloaded = runtime.getModel('custom', 'custom-model');
  assert.deepEqual(reloaded.input, ['text', 'image']);
  assert.equal(reloaded.maxTokens, 2048);
  assert.ok(getSupportedThinkingLevels(reloaded).includes('high'));
  await app.inject({ method: 'PUT', url, payload: { reasoning: false, input: ['text'] } });
  await runtime.refresh({ providers: ['custom'], allowNetwork: false });
  assert.deepEqual(getSupportedThinkingLevels(runtime.getModel('custom', 'custom-model')), ['off']);
  await assert.rejects(service.updateModelCapabilities(summary.providerKey, 'missing', payload));
  const builtin = (await service.listProviders()).providers.find(
    (p) => p.provenance === 'builtin' && p.modelCount > 0
  );
  const builtinDetail = await service.getProvider(builtin.providerKey);
  await assert.rejects(
    service.updateModelCapabilities(builtin.providerKey, builtinDetail.models[0].modelKey, payload)
  );
});

test('local endpoint resaves preserve edited model capabilities and concurrent edits', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'octopus-capabilities-local-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'models.json');
  const record = { name: 'Local', runtime: 'vllm', baseUrl: 'http://localhost:8000', modelId: 'local-model' };
  await saveLocalProvider(path, 'local', record);
  await saveLocalProvider(path, 'other', { ...record, modelId: 'other-model' });
  await Promise.all([
    saveModelCapabilities(path, 'local', record.modelId, { reasoning: true, input: ['text', 'image'] }),
    saveModelCapabilities(path, 'other', 'other-model', { reasoning: true, input: ['text'] }),
  ]);
  await saveLocalProvider(path, 'local', { ...record, baseUrl: 'http://localhost:8001' });
  const document = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(document.providers.local.models[0].reasoning, true);
  assert.deepEqual(document.providers.local.models[0].input, ['text', 'image']);
  assert.equal(document.providers.local.models[0].compat.supportsReasoningEffort, true);
  assert.equal(document.providers.other.models[0].reasoning, true);
});
