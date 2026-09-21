/**
 * @author Codex
 * @description Exercises local provider persistence, runtime-specific discovery and Pi catalog synchronization.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import { createPiSettingsStore } from '../dist/lib/pi-settings/index.js';
import { SettingsService } from '../dist/modules/settings/settings.service.js';
import { registerLocalProviderController } from '../dist/modules/settings/local-provider.controller.js';

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
          runtime === 'ollama' ? { models: [{ name: 'test-model' }] } : { data: [{ id: 'test-model' }] }
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
    t.after(() => service.close());
    const created = await service.createLocalProvider({ name: `My ${runtime}`, runtime });
    assert.equal(created.name, `My ${runtime}`);
    assert.equal(created.modelCount, 0);
    assert.equal(created.auth.configured, false);
    assert.equal(created.local.runtime, runtime);
    const draft = (await createPiSettingsStore({ agentDir }).listProviders()).find((provider) => provider.id === created.providerId);
    assert.equal(draft.name, created.name);
    assert.equal(draft.models.length, 0);
    const before = await store.getDefaultModel();
    const detected = await service.detectLocalProvider(created.providerKey, baseUrl);
    assert.deepEqual(
      detected.models.map((model) => model.id),
      ['test-model']
    );
    await assert.rejects(
      service.configureLocalProvider(created.providerKey, { baseUrl, modelId: 'missing' }),
      { code: 'LOCAL_MODEL_NOT_FOUND' }
    );
    const saved = await service.configureLocalProvider(created.providerKey, {
      baseUrl,
      modelId: 'test-model',
    });
    assert.equal(saved.modelCount, 1);
    assert.equal(saved.availableModelCount, 1);
    assert.equal(saved.local.modelId, 'test-model');
    assert.deepEqual(await store.getDefaultModel(), before);
    assert.ok(paths.every((path) => path === (runtime === 'ollama' ? '/api/tags' : '/v1/models')));
    const document = JSON.parse(await readFile(join(agentDir, 'models.json'), 'utf8'));
    assert.deepEqual(document.unrelated, { keep: true });
    assert.equal(document.providers[created.providerId].baseUrl, `${baseUrl.replace(/\/v1$/, '')}/v1`);
    const reloaded = await createPiSettingsStore({ agentDir }).listProviders();
    assert.equal(reloaded.find((provider) => provider.id === created.providerId).local.modelId, 'test-model');
    const second = await service.createLocalProvider({ name: `Second ${runtime}`, runtime });
    assert.notEqual(second.providerId, created.providerId);
    assert.equal((await service.getProvider(created.providerKey)).modelCount, 1);
    const persisted = await readFile(join(agentDir, 'models.json'), 'utf8');
    mode = 'empty';
    assert.deepEqual(await service.detectLocalProvider(created.providerKey, baseUrl), { reachable: true, models: [] });
    mode = 'offline';
    assert.deepEqual(await service.detectLocalProvider(created.providerKey, baseUrl), { reachable: false, models: [] });
    await assert.rejects(service.configureLocalProvider(created.providerKey, { baseUrl, modelId: 'test-model' }), { code: 'LOCAL_RUNTIME_OFFLINE' });
    assert.equal(await readFile(join(agentDir, 'models.json'), 'utf8'), persisted);
  });
}

test('local routes validate inputs and deduplicate retried creation requests', async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  let calls = 0;
  registerLocalProviderController(app, {
    async createLocalProvider(input) {
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
