/**
 * @author Codex
 * @description Exercises custom provider persistence, local discovery and Pi catalog synchronization.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import { createPiSettingsStore } from '../dist/infrastructure/pi-settings/index.js';
import { SettingsService } from '../dist/modules/model-settings/model-settings.service.js';
import {
  registerCustomProviderController,
  registerSettingsController,
} from '../dist/modules/model-settings/model-settings.controller.js';

for (const runtime of ['ollama', 'vllm', 'lmstudio']) {
  test(`${runtime}: create, discover, save and reload a named provider without changing defaults`, async (t) => {
    const agentDir = await mkdtemp(join(tmpdir(), 'octopus-local-test-'));
    t.after(() => rm(agentDir, { recursive: true, force: true }));
    const paths = [];
    let mode = 'ready';
    const endpoint = createServer((request, response) => {
      paths.push(request.url);
      response.setHeader('content-type', 'application/json');
      if (mode === 'offline') {
        response.statusCode = 503;
        response.end('{}');
        return;
      }
      if (mode === 'empty') {
        response.end(JSON.stringify({ models: [], data: [] }));
        return;
      }
      response.end(
        JSON.stringify(
          runtime === 'ollama'
            ? { models: [{ name: 'test-model' }, { name: 'second-model' }] }
            : { data: [{ id: 'test-model' }, { id: 'second-model' }] }
        )
      );
    });
    await new Promise((resolve) => endpoint.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => endpoint.close(resolve)));
    const baseUrl = `http://127.0.0.1:${endpoint.address().port}${runtime === 'ollama' ? '' : '/v1'}`;
    await writeFile(
      join(agentDir, 'models.json'),
      JSON.stringify({ providers: {}, unrelated: { keep: true } })
    );
    const store = createPiSettingsStore({ agentDir });
    const service = new SettingsService(store);
    const created = await service.createCustomProvider({ name: `My ${runtime}`, runtime });
    assert.equal(created.name, `My ${runtime}`);
    assert.equal(created.modelCount, 0);
    assert.equal(created.auth.configured, false);
    assert.equal(created.local.runtime, runtime);
    const draft = (await createPiSettingsStore({ agentDir }).listProviders()).find(
      (provider) => provider.id === created.providerId
    );
    assert.equal(draft.name, created.name);
    assert.equal(draft.models.length, 0);
    const before = await store.getDefaultModel();
    const detected = await service.detectCustomProvider(created.providerKey, baseUrl);
    assert.deepEqual(
      detected.models.map((model) => model.id),
      ['test-model', 'second-model']
    );
    const saved = await service.configureCustomProvider(created.providerKey, { baseUrl });
    assert.equal(saved.modelCount, 2);
    assert.equal(saved.availableModelCount, 2);
    assert.deepEqual(
      saved.models.map((model) => model.modelId),
      ['test-model', 'second-model']
    );
    assert.deepEqual(await store.getDefaultModel(), before);
    assert.ok(paths.every((path) => path === (runtime === 'ollama' ? '/api/tags' : '/v1/models')));
    const document = JSON.parse(await readFile(join(agentDir, 'models.json'), 'utf8'));
    assert.deepEqual(document.unrelated, { keep: true });
    assert.equal(document.providers[created.providerId].baseUrl, `${baseUrl.replace(/\/v1$/, '')}/v1`);
    const reloaded = await createPiSettingsStore({ agentDir }).listProviders();
    assert.deepEqual(
      reloaded.find((provider) => provider.id === created.providerId).models.map((model) => model.id),
      ['test-model', 'second-model']
    );
    const second = await service.createCustomProvider({ name: `Second ${runtime}`, runtime });
    assert.notEqual(second.providerId, created.providerId);
    assert.equal((await service.getProvider(created.providerKey)).modelCount, 2);
    const persisted = await readFile(join(agentDir, 'models.json'), 'utf8');
    mode = 'offline';
    assert.deepEqual(await service.detectCustomProvider(created.providerKey, baseUrl), {
      reachable: false,
      models: [],
    });
    await assert.rejects(service.configureCustomProvider(created.providerKey, { baseUrl }), {
      code: 'LOCAL_RUNTIME_OFFLINE',
    });
    assert.equal(await readFile(join(agentDir, 'models.json'), 'utf8'), persisted);
    mode = 'empty';
    const cleared = await service.configureCustomProvider(created.providerKey, { baseUrl });
    assert.equal(cleared.modelCount, 0);
    assert.deepEqual(
      JSON.parse(await readFile(join(agentDir, 'models.json'), 'utf8')).providers[created.providerId].models,
      []
    );
  });
}

test('local routes validate inputs and deduplicate retried creation requests', async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  let calls = 0;
  registerCustomProviderController(app, {
    async createCustomProvider(input) {
      calls++;
      return input;
    },
  });
  const request = {
    method: 'POST',
    url: '/settings/local-providers',
    headers: { 'idempotency-key': randomUUID() },
    payload: { name: 'Local', runtime: 'ollama' },
  };
  assert.equal((await app.inject(request)).statusCode, 201);
  assert.equal((await app.inject(request)).statusCode, 201);
  assert.equal(calls, 1);
  for (const payload of [
    { name: '', runtime: 'ollama' },
    { name: 'X', runtime: 'unknown' },
  ]) {
    assert.equal((await app.inject({ ...request, payload })).statusCode, 400);
  }
  for (const baseUrl of [
    'file:///tmp/models',
    'http://user:secret@localhost',
    'http://localhost?key=secret',
  ]) {
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/settings/model-providers/key/local/detect',
          payload: { baseUrl },
        })
      ).statusCode,
      400
    );
  }
});

for (const [runtime, api] of [
  ['openai-compatible', 'openai-completions'],
  ['mr-token', 'openai-responses'],
]) {
  test(`${runtime}: configure with API Key, reload, and delete from the existing provider flow`, async (t) => {
    const agentDir = await mkdtemp(join(tmpdir(), 'octopus-remote-test-'));
    t.after(() => rm(agentDir, { recursive: true, force: true }));
    const store = createPiSettingsStore({ agentDir });
    const service = new SettingsService(store);
    const name = runtime === 'mr-token' ? 'Mr.Token' : 'My OpenAI service';
    const created = await service.createCustomProvider({ name, runtime });
    const requests = [];
    let offeredModels = [{ id: 'example-model' }, { id: 'other-model' }, { id: 'example-model' }];
    const endpoint = createServer((request, response) => {
      requests.push({ path: request.url, authorization: request.headers.authorization });
      response.setHeader('content-type', 'application/json');
      if (request.headers.authorization !== 'Bearer sk-test-secret') {
        response.statusCode = 401;
        response.end('{}');
        return;
      }
      response.end(JSON.stringify({ data: offeredModels }));
    });
    await new Promise((resolve) => endpoint.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => endpoint.close(resolve)));
    const baseUrl = `http://127.0.0.1:${endpoint.address().port}${runtime === 'mr-token' ? '/v1' : '/custom/api'}`;
    await assert.rejects(service.configureCustomProvider(created.providerKey, { baseUrl, api }), {
      code: 'MODEL_PROVIDER_API_KEY_REQUIRED',
    });
    const saved = await service.configureCustomProvider(created.providerKey, {
      baseUrl,
      api,
      apiKey: 'sk-test-secret',
    });
    assert.equal(saved.local.runtime, runtime);
    assert.deepEqual(await service.detectCustomProvider(created.providerKey, baseUrl), {
      reachable: true,
      models: [{ id: 'example-model' }, { id: 'other-model' }],
    });
    assert.ok(requests.length >= 2);
    assert.ok(
      requests.every(
        (request) => request.path === (runtime === 'mr-token' ? '/v1/models' : '/custom/api/models')
      )
    );
    assert.ok(requests.every((request) => request.authorization === 'Bearer sk-test-secret'));
    await assert.rejects(service.detectCustomProvider(created.providerKey, baseUrl, 'invalid'), {
      code: 'MODEL_DISCOVERY_AUTH_FAILED',
    });
    assert.equal(saved.local.api, api);
    assert.equal(saved.availableModelCount, 2);
    assert.deepEqual(
      saved.models.map((model) => model.modelId),
      ['example-model', 'other-model']
    );
    assert.equal(saved.auth.source, 'stored');
    const modelsText = await readFile(join(agentDir, 'models.json'), 'utf8');
    assert.equal(modelsText.includes('sk-test-secret'), false);
    const document = JSON.parse(modelsText);
    assert.equal(document.providers[created.providerId].api, api);
    assert.equal(document.providers[created.providerId].baseUrl, baseUrl);
    assert.deepEqual(
      document.providers[created.providerId].models.map((model) => model.id),
      ['example-model', 'other-model']
    );
    await service.updateModelCapabilities(created.providerKey, saved.models[0].modelKey, {
      reasoning: true,
      input: ['text', 'image'],
      imageGeneration: true,
    });
    await service.updateModelCapabilities(created.providerKey, saved.models[1].modelKey, {
      reasoning: false,
      input: ['text'],
      imageGeneration: false,
    });
    offeredModels = [{ id: 'example-model' }, { id: 'fresh-model' }];
    const refreshed = await service.configureCustomProvider(created.providerKey, { baseUrl, api });
    assert.deepEqual(
      refreshed.models.map((model) => model.modelId),
      ['example-model', 'fresh-model']
    );
    assert.equal(refreshed.models[0].reasoning, true);
    assert.deepEqual(refreshed.models[0].input, ['text', 'image']);
    assert.deepEqual(refreshed.models[0].capabilities, ['reasoning', 'image_input', 'image_generation']);
    assert.deepEqual(refreshed.models[1].capabilities, []);
    assert.deepEqual(refreshed.models[0].interfaces, ['chat']);
    const refreshedDocument = JSON.parse(await readFile(join(agentDir, 'models.json'), 'utf8'));
    assert.deepEqual(refreshedDocument.octopusModelCapabilities[created.providerId], {
      'example-model': { imageGeneration: true },
    });
    const reloaded = (await createPiSettingsStore({ agentDir }).listProviders()).find(
      (provider) => provider.id === created.providerId
    );
    assert.equal(reloaded.auth.source, 'stored');
    await store.setDefaultModel(created.providerId, 'example-model');
    await assert.rejects(service.deleteCustomProvider(created.providerKey), {
      code: 'MODEL_PROVIDER_DEFAULT_IN_USE',
    });
    await writeFile(join(agentDir, 'settings.json'), '{}');
    assert.deepEqual(await service.deleteCustomProvider(created.providerKey), { deleted: true });
    assert.equal(await service.getProvider(created.providerKey), undefined);
    const deletedDocument = JSON.parse(await readFile(join(agentDir, 'models.json'), 'utf8'));
    assert.equal(deletedDocument.octopusModelCapabilities?.[created.providerId], undefined);
    assert.equal((await readFile(join(agentDir, 'auth.json'), 'utf8')).includes('sk-test-secret'), false);
  });
}

test('a local service accepts an optional API Key without requiring unauthenticated model discovery', async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), 'octopus-local-key-test-'));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  const requests = [];
  const endpoint = createServer((request, response) => {
    requests.push({ path: request.url, authorization: request.headers.authorization });
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ data: [{ id: 'protected-model' }] }));
  });
  await new Promise((resolve) => endpoint.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => endpoint.close(resolve)));
  const baseUrl = `http://127.0.0.1:${endpoint.address().port}/v1`;
  const service = new SettingsService(createPiSettingsStore({ agentDir }));
  const created = await service.createCustomProvider({ name: 'Protected vLLM', runtime: 'vllm' });
  const configured = await service.configureCustomProvider(created.providerKey, {
    baseUrl,
    apiKey: 'sk-local-test',
  });
  assert.equal(configured.auth.source, 'stored');
  assert.equal(configured.availableModelCount, 1);
  const savedAgain = await service.configureCustomProvider(created.providerKey, {
    baseUrl,
  });
  assert.equal(savedAgain.availableModelCount, 1);
  assert.ok(
    requests.every(
      (request) => request.path === '/v1/models' && request.authorization === 'Bearer sk-local-test'
    )
  );
  assert.equal((await readFile(join(agentDir, 'models.json'), 'utf8')).includes('sk-local-test'), false);
});

test('the existing provider detail route deletes a managed service', async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  let deletedKey;
  registerSettingsController(app, {
    async deleteCustomProvider(key) {
      deletedKey = key;
      return { deleted: true };
    },
  });
  const response = await app.inject({ method: 'DELETE', url: '/settings/model-providers/provider-key' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { deleted: true });
  assert.equal(deletedKey, 'provider-key');
});

test('a configured local service without an API Key can be deleted', async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), 'octopus-local-delete-test-'));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  const endpoint = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ data: [{ id: 'local-model' }] }));
  });
  await new Promise((resolve) => endpoint.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => endpoint.close(resolve)));
  const service = new SettingsService(createPiSettingsStore({ agentDir }));
  const created = await service.createCustomProvider({ name: 'Local', runtime: 'vllm' });
  await service.configureCustomProvider(created.providerKey, {
    baseUrl: `http://127.0.0.1:${endpoint.address().port}/v1`,
  });
  assert.deepEqual(await service.deleteCustomProvider(created.providerKey), { deleted: true });
  assert.equal(await service.getProvider(created.providerKey), undefined);
});

test('an unconfigured provider draft can be deleted immediately', async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), 'octopus-draft-delete-test-'));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  const service = new SettingsService(createPiSettingsStore({ agentDir }));
  const created = await service.createCustomProvider({ name: 'Draft', runtime: 'mr-token' });
  assert.deepEqual(await service.deleteCustomProvider(created.providerKey), { deleted: true });
  assert.equal(await service.getProvider(created.providerKey), undefined);
});
