/**
 * @author Codex
 * @description Verify optional Jev configuration, private credentials, bounded evaluation and conservative screening.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, access, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createAgentEnvironmentStore } from '../dist/utils/environment.js';
import { JevSettingsStore, JevError } from '../dist/lib/jev/settings.js';
import { evaluateJevChoice, listJevModels } from '../dist/lib/jev/client.js';
import { MemoryScreeningSettingsStore } from '../dist/extensions/memory/lib/screening-settings.js';
import { screenMemoryWithJev } from '../dist/extensions/memory/lib/jev-screen.js';

/**
 * Bind isolated config files without touching the user's Agent profile.
 */
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'jev-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new JevSettingsStore(root, {});
  return { root, store, screening: new MemoryScreeningSettingsStore(root) };
}
/**
 * Strip display-only fields before constructing a complete update.
 */
function update(snapshot, changes = {}) {
  const { revision, model } = snapshot;
  const input = { revision, model };
  return { ...input, ...changes };
}
const sources = [{ sessionId: 'test-session', entryId: 'user', evidence: '你好' }];
const question = {
  instructions: 'Does this require memory?',
  criteria: { skip: 'No', candidate: 'Yes', uncertain: 'Insufficient evidence' },
};
/**
 * Return a real Fetch response with a controlled evaluation distribution.
 */
function response(choice = 'skip', probabilities = { skip: 0.98, candidate: 0.01, uncertain: 0.01 }) {
  return Response.json({
    model: 'jev-1.13.0',
    answers: { decision: { type: 'choice', choice, probabilities } },
  });
}

test('default is disabled and reads do not create configuration or call Jev', async (t) => {
  const { store, screening } = await fixture(t);
  const state = await store.get();
  assert.equal((await screening.get()).enabled, false);
  assert.equal('enabled' in state, false);
  assert.equal(state.hasApiKey, false);
  await assert.rejects(access(store.path), { code: 'ENOENT' });
  const result = await screenMemoryWithJev(store, screening, sources, new AbortController().signal, () =>
    assert.fail('disabled evaluation')
  );
  assert.deepEqual(result, { skip: false, reason: 'DISABLED' });
});

test('credentials come only from TYPESAFE_API_KEY and never enter the Jev document or response', async (t) => {
  const { root, store } = await fixture(t);
  const env = createAgentEnvironmentStore(root, {});
  const initial = await store.get();
  await assert.rejects(store.update(update(initial, { apiKey: 'not-allowed' })), {
    code: 'JEV_CONFIG_INVALID',
  });
  await env.update(env.load().revision, { TYPESAFE_API_KEY: 'test-private-key' });
  assert.equal((await store.get()).hasApiKey, true);
  const saved = await store.update(update(initial));
  assert.ok(!JSON.stringify(saved).includes('test-private-key'));
  assert.ok(!(await readFile(store.path, 'utf8')).includes('apiKey'));
  assert.equal(store.getApiKey(), 'test-private-key');
  assert.equal(new JevSettingsStore(root, { TYPESAFE_API_KEY: 'launch-key' }).getApiKey(), 'launch-key');
  assert.equal(new JevSettingsStore(root, { TYPESAFE_API_KEY: '' }).getApiKey(), undefined);
  await assert.rejects(store.update(update(initial)), { code: 'JEV_CONFIG_CONFLICT' });
  await env.update(env.load().revision, { TYPESAFE_API_KEY: null });
  assert.equal((await store.get()).hasApiKey, false);
  const modelUpdated = await store.update(update(saved, { model: 'jev-latest' }));
  await assert.rejects(
    store.update(update(modelUpdated, { memory: { enabled: true, skipThreshold: 0.5 } })),
    {
      code: 'JEV_CONFIG_INVALID',
    }
  );
});

test('different writers cannot overwrite the same revision', async (t) => {
  const { root, store } = await fixture(t);
  const other = new JevSettingsStore(root, {});
  const initial = await store.get();
  const results = await Promise.allSettled([
    store.update(update(initial, { model: 'jev-latest' })),
    other.update(update(initial, { model: 'jev-preview' })),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.ok(
    ['JEV_CONFIG_BUSY', 'JEV_CONFIG_CONFLICT'].includes(
      results.find((r) => r.status === 'rejected').reason.code
    )
  );
});

test('Choice transport validates probabilities, rejects redirects and never exposes provider bodies', async () => {
  const config = { model: 'jev-1.13.0', timeoutMs: 1500 };
  const result = await evaluateJevChoice(config, { message: '原文' }, question, {
    apiKey: 'test-private-key',
    fetch: async (url, options) => {
      assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
      assert.equal(options.redirect, 'error');
      assert.equal(new Headers(options.headers).get('authorization'), 'Bearer test-private-key');
      assert.equal(JSON.parse(options.body).state.message, '原文');
      return response();
    },
  });
  assert.equal(result.choice, 'skip');
  for (const output of [
    response('skip', { skip: 1 }),
    response('skip', { skip: 0.2, candidate: 0.7, uncertain: 0.1 }),
    response('skip', { skip: 0.4, candidate: 0.1, uncertain: 0.1 }),
    new Response('test-private-key echoed by remote', { status: 401 }),
    new Response('invalid JSON test-private-key'),
  ]) {
    await assert.rejects(
      evaluateJevChoice(config, {}, question, { apiKey: 'test-private-key', fetch: async () => output }),
      (error) => {
        assert.ok(error instanceof JevError);
        assert.ok(!String(error).includes('test-private-key'));
        return true;
      }
    );
  }
});

test('provider timeout is bounded and caller cancellation is preserved', async () => {
  const config = { model: 'jev-1.13.0', timeoutMs: 250 };
  const wait = async (_url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });
  await Promise.all([
    assert.rejects(evaluateJevChoice(config, {}, question, { apiKey: 'test-key', fetch: wait }), {
      code: 'JEV_TIMEOUT',
    }),
    delay(275),
  ]);
  const controller = new AbortController();
  const request = evaluateJevChoice(config, {}, question, {
    apiKey: 'test-key',
    signal: controller.signal,
    fetch: wait,
  });
  controller.abort();
  await assert.rejects(request, { name: 'AbortError' });
});

test('the SDK reads TYPESAFE_API_KEY and never retries rate limits', async () => {
  const previous = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = 'environment-test-key';
  let calls = 0;
  try {
    await assert.rejects(
      evaluateJevChoice({ model: 'jev-1.13.0', timeoutMs: 500 }, {}, question, {
        fetch: async (_url, options) => {
          calls++;
          assert.equal(new Headers(options.headers).get('authorization'), 'Bearer environment-test-key');
          return Response.json({ message: 'private provider diagnostic' }, { status: 429 });
        },
      }),
      { code: 'JEV_REQUEST_FAILED' }
    );
    assert.equal(calls, 1);
  } finally {
    if (previous === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = previous;
  }
});

test('memory skips only confident skip, fails open, and discards decisions after configuration changes', async (t) => {
  const { root, store, screening } = await fixture(t);
  const env = createAgentEnvironmentStore(root, {});
  await env.update(env.load().revision, { TYPESAFE_API_KEY: 'test-key' });
  let settings = await store.update(update(await store.get()));
  await screening.update({ ...(await screening.get()), enabled: true });
  const signal = new AbortController().signal;
  for (const [choice, probability, skip] of [
    ['skip', 0.95, true],
    ['skip', 0.94, false],
    ['candidate', 0.01, false],
    ['uncertain', 0.1, false],
  ]) {
    const result = await screenMemoryWithJev(store, screening, sources, signal, async () => ({
      choice,
      probabilities: { skip: probability },
    }));
    assert.equal(result.skip, skip);
  }
  assert.equal(
    (
      await screenMemoryWithJev(store, screening, sources, signal, async () => {
        throw new JevError('JEV_TIMEOUT');
      })
    ).skip,
    false
  );
  const changed = await screenMemoryWithJev(store, screening, sources, signal, async () => {
    settings = await store.update(update(settings, { model: 'jev-preview' }));
    return { choice: 'skip', probabilities: { skip: 1 } };
  });
  assert.deepEqual(changed, { skip: false, reason: 'CONFIG_CHANGED' });
  const policyChanged = await screenMemoryWithJev(store, screening, sources, signal, async () => {
    await screening.update({ ...(await screening.get()), enabled: false });
    return { choice: 'skip', probabilities: { skip: 1 } };
  });
  assert.deepEqual(policyChanged, { skip: false, reason: 'CONFIG_CHANGED' });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(screenMemoryWithJev(store, screening, sources, controller.signal), {
    name: 'AbortError',
  });
});

test('credential edits reuse the environment revision, preserve other values and expose only metadata', async (t) => {
  const { root, store } = await fixture(t);
  const env = createAgentEnvironmentStore(root, {});
  await env.update(env.load().revision, { OTHER_TOKEN: 'unrelated-value' });
  const before = await store.get();
  const next = await store.updateCredential({
    revision: before.environmentRevision,
    apiKey: 'saved-test-key',
  });
  assert.equal('enabled' in next, false);
  assert.equal(next.hasStoredApiKey, true);
  assert.equal(next.apiKeyOverridden, false);
  assert.equal(next.hasApiKey, true);
  assert.equal(env.get('TYPESAFE_API_KEY'), 'saved-test-key');
  assert.equal(env.get('OTHER_TOKEN'), 'unrelated-value');
  assert.ok(!JSON.stringify(next).includes('saved-test-key'));
  await assert.rejects(access(store.path), { code: 'ENOENT' });
  await assert.rejects(store.updateCredential({ revision: before.environmentRevision, apiKey: null }), {
    code: 'JEV_CONFIG_CONFLICT',
  });
  await assert.rejects(store.updateCredential({ revision: next.environmentRevision, apiKey: ' ' }), {
    code: 'JEV_CONFIG_INVALID',
  });
  const overridden = new JevSettingsStore(root, { TYPESAFE_API_KEY: 'launch-test-key' });
  const cleared = await overridden.updateCredential({ revision: next.environmentRevision, apiKey: null });
  assert.equal(cleared.hasStoredApiKey, false);
  assert.equal(cleared.hasApiKey, true);
  assert.equal(cleared.apiKeyOverridden, true);
  assert.equal((await store.get()).hasApiKey, false);
  assert.equal(env.get('OTHER_TOKEN'), 'unrelated-value');
});

test('memory owns its screening settings with independent revisions and strict validation', async (t) => {
  const { root, store, screening } = await fixture(t);
  const initial = await screening.get();
  assert.equal(initial.enabled, false);
  const saved = await screening.update({ ...initial, enabled: true });
  assert.equal(saved.skipThreshold, 0.95);
  await assert.rejects(screening.update({ ...initial, enabled: false }), {
    code: 'MEMORY_SCREENING_CONFLICT',
  });
  await assert.rejects(screening.update({ ...saved, skipThreshold: 0.5 }), {
    code: 'MEMORY_SCREENING_INVALID',
  });
  await assert.rejects(screening.update({ ...saved, model: 'jev-latest' }), {
    code: 'MEMORY_SCREENING_INVALID',
  });
  assert.equal((await store.get()).revision, 'absent');
  await store.update(update(await store.get(), { model: 'jev-preview' }));
  assert.deepEqual(await screening.get(), saved);
  const policy = JSON.parse(await readFile(join(root, 'memory', 'screening.json'), 'utf8'));
  assert.deepEqual(policy, { enabled: true, timeoutMs: 1500, skipThreshold: 0.95 });
  assert.deepEqual(JSON.parse(await readFile(store.path, 'utf8')), { model: 'jev-preview' });
});

test('model discovery uses the official SDK and rejects unsafe provider responses', async () => {
  const models = await listJevModels({
    apiKey: 'list-test-key',
    fetch: async (url, options) => {
      assert.equal(url, 'https://api.typesafe.ai/v1/models');
      assert.equal(options.method, 'GET');
      assert.equal(options.redirect, 'error');
      assert.equal(new Headers(options.headers).get('authorization'), 'Bearer list-test-key');
      return Response.json({
        models: [{ name: 'jev-latest' }, { name: 'jev-preview' }, { name: 'jev-latest' }],
      });
    },
  });
  assert.deepEqual(models, ['jev-latest', 'jev-preview']);
  await assert.rejects(listJevModels({ apiKey: '', fetch: () => assert.fail('missing key must not send') }), {
    code: 'JEV_KEY_REQUIRED',
  });
  await assert.rejects(
    listJevModels({
      apiKey: 'list-test-key',
      fetch: async () => Response.json({ models: [{ name: 'invalid key echoed' }] }),
    }),
    { code: 'JEV_RESPONSE_INVALID' }
  );
  await assert.rejects(
    listJevModels({
      apiKey: 'list-test-key',
      fetch: async () => new Response('list-test-key', { status: 401 }),
    }),
    { code: 'JEV_REQUEST_FAILED' }
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(listJevModels({ apiKey: 'list-test-key', signal: controller.signal }), {
    name: 'AbortError',
  });
});
