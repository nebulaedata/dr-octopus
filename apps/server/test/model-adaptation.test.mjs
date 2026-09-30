/**
 * @author Codex
 * @description Verifies native catalog matching, Pi wire parity, catalog refresh and relay admission without external requests.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import {
  adaptRelayModel,
  readBuiltinModelCatalog,
} from '../dist/infrastructure/pi-settings/model-adaptation.js';
import {
  saveCustomProvider,
  saveModelAssociation,
  reconcileRelayModels,
} from '../dist/infrastructure/pi-settings/custom-provider-repository.js';
import { createPiSettingsStore } from '../dist/infrastructure/pi-settings/index.js';
import { SettingsService } from '../dist/modules/model-settings/model-settings.service.js';
import { RuntimeCommands } from '../dist/infrastructure/runtime/commands.js';

const catalog = readBuiltinModelCatalog();

test('matches native exact IDs and rejects unknown and ambiguous templates', () => {
  assert.equal(adaptRelayModel('qwen3.8-max', catalog).adaptation.status, 'adapted');
  assert.equal(adaptRelayModel('deepseek-v4-flash', catalog).adaptation.source.providerId, 'deepseek');
  assert.equal(adaptRelayModel('unknown', catalog).adaptation.reason, 'not_found');
  assert.equal(adaptRelayModel('gpt-6-astra', catalog).adaptation.source.providerId, 'openai');
  const qwen = catalog.find((m) => m.provider === 'qwen-token-plan' && m.id === 'qwen3.8-max');
  assert.equal(
    adaptRelayModel(qwen.id, [qwen, { ...qwen, provider: 'qwen-token-plan-cn', maxTokens: 3 }]).adaptation
      .reason,
    'ambiguous'
  );
  assert.equal(adaptRelayModel(qwen.id, [{ ...qwen, compat: {} }]).adaptation.reason, 'incomplete');
  assert.equal(
    adaptRelayModel(qwen.id, [{ ...qwen, provider: 'openrouter' }]).adaptation.reason,
    'not_found'
  );
});

/**
 * Captures Pi's public adapter payload before any transport, using the same reasoning and tool definitions.
 */
async function payload(model, reasoning) {
  let captured;
  const result = streamSimple(
    model,
    {
      systemPrompt: 'Use tools when needed.',
      messages: [{ role: 'user', content: 'Hello', timestamp: 1 }],
      tools: [
        { name: 'lookup', description: 'Look up a value', parameters: { type: 'object', properties: {} } },
      ],
    },
    {
      apiKey: 'test',
      reasoning,
      maxTokens: 1024,
      onPayload: (body) => {
        captured = body;
        throw new Error('Captured before transport');
      },
      fetch: () => {
        throw new Error('No network allowed');
      },
    }
  );
  await result.result();
  assert.ok(captured, 'Pi must build the request body');
  return captured;
}

test('every accepted completions template preserves the native Pi payload', async () => {
  const ids = new Set(catalog.filter((model) => model.api === 'openai-completions').map((model) => model.id));
  let checked = 0;
  for (const id of ids) {
    const adapted = adaptRelayModel(id, catalog);
    if (adapted.adaptation.status !== 'adapted') continue;
    const source = catalog.find(
      (model) => model.id === id && model.provider === adapted.adaptation.source.providerId
    );
    const relay = {
      ...source,
      ...adapted.definition,
      provider: 'octopus-mr-token-test',
      baseUrl: 'https://relay.invalid/v1',
    };
    assert.deepEqual(await payload(relay, 'high'), await payload(source, 'high'), id);
    checked += 1;
  }
  assert.ok(checked >= 3);
});

for (const id of ['qwen3.8-max', 'deepseek-v4-flash', 'kimi-k3']) {
  test(`${id}: native and relay configurations produce identical Pi request bodies`, async () => {
    const adapted = adaptRelayModel(id, catalog);
    assert.equal(adapted.adaptation.status, 'adapted');
    const source = catalog.find((m) => m.provider === adapted.adaptation.source.providerId && m.id === id);
    const relay = {
      ...source,
      ...adapted.definition,
      provider: 'octopus-mr-token-test',
      baseUrl: 'https://relay.invalid/v1',
    };
    for (const reasoning of [undefined, 'low', 'high']) {
      const expected = await payload(source, reasoning);
      const actual = await payload(relay, reasoning);
      assert.deepEqual(actual, expected);
      assert.equal(actual.messages[0].role, 'system');
    }
  });
}

test('reconciles current relay metadata, excludes unknown models and refreshes idempotently', async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), 'octopus-adaptation-'));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  const path = join(agentDir, 'models.json');
  const id = 'octopus-mr-token-test';
  const record = {
    name: 'Mr.Token',
    runtime: 'mr-token',
    baseUrl: 'https://relay.invalid/v1',
    api: 'openai-completions',
  };
  await writeFile(
    path,
    JSON.stringify({
      providers: {
        [id]: {
          api: record.api,
          baseUrl: record.baseUrl,
          apiKey: 'test',
          models: [],
        },
      },
      octopusLocalProviders: { [id]: record },
      octopusRelayModels: {
        [id]: [
          { id: 'qwen3.8-max', adaptation: { status: 'unadapted', reason: 'not_found' } },
          { id: 'unknown', adaptation: { status: 'unadapted', reason: 'not_found' } },
        ],
      },
      unrelated: { keep: true },
    })
  );
  const store = createPiSettingsStore({ agentDir });
  const service = new SettingsService(store);
  const provider = (await store.listProviders()).find((p) => p.id === id);
  assert.equal(provider.models.length, 2);
  const known = provider.models.find((m) => m.id === 'qwen3.8-max');
  assert.equal(known.available, true);
  const native = catalog.find((m) => m.provider === 'qwen-token-plan' && m.id === known.id);
  assert.equal(known.contextWindow, native.contextWindow);
  assert.deepEqual(known.input, native.input);
  assert.equal(provider.models.find((m) => m.id === 'unknown').available, false);
  assert.equal(provider.models.find((m) => m.id === 'unknown').contextWindow, undefined);
  assert.equal(provider.models.find((m) => m.id === 'unknown').maxTokens, undefined);
  assert.deepEqual(
    await service.filterChatModels([
      { provider: id, id: 'unknown' },
      { provider: id, id: 'removed' },
    ]),
    []
  );
  await assert.rejects(store.setDefaultModel(id, 'unknown'));
  const document = JSON.parse(await readFile(path, 'utf8'));
  assert.deepEqual(document.unrelated, { keep: true });
  assert.equal(document.providers[id].models.length, 1);
  assert.equal(document.providers[id].models[0].compat.supportsDeveloperRole, false);
  const before = (await stat(path)).mtimeMs;
  await reconcileRelayModels(path);
  assert.equal((await stat(path)).mtimeMs, before, 'no watcher loop');
  await saveModelAssociation(path, id, 'unknown', { providerId: 'qwen-token-plan', modelId: known.id });
  await saveCustomProvider(path, id, record, [{ id: known.id }, { id: 'unknown' }]);
  const reloaded = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(reloaded.providers[id].models[1].id, 'unknown');
  assert.equal(reloaded.providers[id].models[1].contextWindow, native.contextWindow);
  assert.equal(reloaded.octopusRelayModels[id][1].source.modelId, known.id);
  await saveModelAssociation(path, id, 'unknown', null);
  const runtime = await ModelRuntime.create({
    modelsPath: path,
    authPath: join(agentDir, 'auth.json'),
    allowModelNetwork: false,
  });
  assert.equal(runtime.getError(), undefined);
  assert.equal(runtime.getModel(id, 'unknown'), undefined);
});

test('existing runtime inference and direct model selection cannot bypass the admission callback', async () => {
  const calls = [];
  const target = {
    execute: async (command) => {
      calls.push(command.type);
      return { success: true, data: { model: { provider: 'relay', id: 'unknown' } } };
    },
    binding: { runtimeId: 'r' },
    epoch: 1,
  };
  const commands = new RuntimeCommands({
    withRuntime: async (_id, operation) => operation(target),
    assertModelAllowed: async () => {
      throw new Error('Unadapted');
    },
  });
  for (const command of [
    { type: 'prompt', message: 'Hi' },
    { type: 'steer', message: 'Hi' },
    { type: 'follow_up', message: 'Hi' },
    { type: 'compact' },
    { type: 'set_model', provider: 'relay', modelId: 'unknown' },
  ]) {
    await assert.rejects(commands.execute('s', command), /Unadapted/);
  }
  assert.ok(calls.every((type) => type === 'get_state'));
});
