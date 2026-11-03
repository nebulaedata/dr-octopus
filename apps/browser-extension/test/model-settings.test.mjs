/**
 * @author Codex
 * @description Verifies local credential isolation and page-owned connection probes without real provider traffic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { setImmediate } from 'node:timers/promises';
const require = createRequire(import.meta.url);
const { outputFiles } = await build({
  stdin: {
    contents:
      "export { ModelSettingsRepository } from './src/lib/model-settings/model-settings-repository'; export { ModelSettingsService } from './src/lib/model-settings/model-settings-service';",
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
});

/**
 * Provides browser event semantics without requiring an installed extension or sharing test storage.
 */
function event() {
  const listeners = new Set();
  return {
    addListener: (fn) => listeners.add(fn),
    removeListener: (fn) => listeners.delete(fn),
    fire: (...args) => {
      for (const fn of listeners) {
        fn(...args);
      }
    },
  };
}

/**
 * Supplies real repository/service implementations over deterministic trusted-browser APIs.
 */
function fixture(initial = {}) {
  const local = structuredClone(initial);
  const state = { failWrite: false, access: null, writes: 0 };
  const browser = {
    runtime: { id: 'owned', getURL: (path) => 'chrome-extension://owned' + path },
    storage: {
      local: {
        setAccessLevel: async (value) => {
          state.access = value.accessLevel;
        },
        get: async (key) =>
          Object.fromEntries(
            (Array.isArray(key) ? key : [key]).map((name) => [name, structuredClone(local[name])])
          ),
        set: async (value) => {
          if (state.failWrite) {
            throw new Error('disk');
          }
          state.writes++;
          Object.assign(local, structuredClone(value));
        },
      },
    },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputFiles[0].text)(
    (name) => (name === 'wxt/browser' ? { browser } : require(name)),
    module,
    module.exports
  );
  const repo = new module.exports.ModelSettingsRepository();
  const service = new module.exports.ModelSettingsService(repo);
  const settings = {
    provider: 'openai-compatible',
    baseUrl: 'http://provider.example:80/v1/',
    model: 'fixture',
  };
  /**
   * Delivers one authenticated request and records only the service's response.
   */
  function connect(message, url = browser.runtime.getURL('/popup.html')) {
    const replies = [];
    let resolveReply;
    const reply = new Promise((resolve) => {
      resolveReply = resolve;
    });
    const port = {
      name: 'octopus-model-settings',
      sender: { id: 'owned', url },
      onMessage: event(),
      onDisconnect: event(),
      closed: false,
      postMessage: (value) => {
        replies.push(value);
        resolveReply(value);
      },
      disconnect: () => {
        port.closed = true;
        port.onDisconnect.fire();
      },
    };
    service.connect(port);
    port.onMessage.fire(message);
    return { port, reply, replies };
  }
  return { local, state, repo, settings, connect };
}

/**
 * Returns a minimal compatible model completion; it never carries private application data.
 */
function completion(text = 'OK') {
  return Response.json({
    id: 'test',
    model: 'fixture',
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
  });
}

test('explicit saves persist only endpoint-bound keys with trusted-context access and presence-only UI replies', async () => {
  const f = fixture();
  await f.repo.save(f.settings, 'SYNTHETIC-SAVED-KEY');
  assert.equal(f.state.access, 'TRUSTED_CONTEXTS');
  assert.equal(await f.repo.resolve('http://PROVIDER.example/v1'), 'SYNTHETIC-SAVED-KEY');
  for (const endpoint of [
    'https://provider.example/v1',
    'http://provider.example/v2',
    'http://other.example/v1',
    'http://provider.example:81/v1',
  ]) {
    assert.equal(await f.repo.resolve(endpoint), '');
  }
  const response = await f.connect({ type: 'credential-status', baseUrl: f.settings.baseUrl }).reply;
  assert.deepEqual(response, { ok: true, value: { hasKey: true, canSend: false } });
  assert.equal(JSON.stringify(response).includes('SYNTHETIC'), false);
  const reopened = fixture(f.local);
  assert.equal(await reopened.repo.resolve(f.settings.baseUrl), 'SYNTHETIC-SAVED-KEY');
  assert.equal(await reopened.repo.resolve(f.settings.baseUrl, 'ONE-REQUEST'), 'ONE-REQUEST');
  assert.equal(await reopened.repo.resolve(f.settings.baseUrl, ''), '');
});

test('save/clear writes are ordered, endpoint-specific and do not report or partially apply failed persistence', async () => {
  const f = fixture();
  await f.repo.save(f.settings, 'OLD');
  await f.repo.save({ ...f.settings, baseUrl: 'https://other.example/v1' }, 'OTHER');
  f.state.failWrite = true;
  await assert.rejects(f.repo.save(f.settings, 'NEW'));
  await assert.rejects(f.repo.clear(f.settings.baseUrl));
  assert.equal(await f.repo.resolve(f.settings.baseUrl), 'OLD');
  f.state.failWrite = false;
  await Promise.all([f.repo.save(f.settings, 'NEW'), f.repo.clear(f.settings.baseUrl)]);
  assert.equal(await f.repo.resolve(f.settings.baseUrl), '');
  assert.equal(await f.repo.resolve('https://other.example/v1'), 'OTHER');
});

test('endpoint consent survives re-entry, never follows another base path, and can be revoked without clearing the key', async () => {
  const f = fixture();
  assert.equal(await f.repo.canSend(f.settings.baseUrl), false);
  await f.repo.save(f.settings, 'SYNTHETIC', true);
  const restarted = fixture(f.local);
  assert.equal(await restarted.repo.canSend('http://PROVIDER.example/v1'), true);
  assert.equal(await restarted.repo.canSend('http://provider.example/other'), false);
  assert.equal(await restarted.repo.canSend('https://provider.example/v1'), false);
  await restarted.repo.save(f.settings, undefined, false);
  assert.equal(await restarted.repo.canSend(f.settings.baseUrl), false);
  assert.equal(await restarted.repo.resolve(f.settings.baseUrl), 'SYNTHETIC');
});

test('content scripts and unrelated extension documents cannot query or clear credentials', async () => {
  const f = fixture();
  await f.repo.save(f.settings, 'SYNTHETIC');
  for (const url of [
    'https://page.example/',
    'chrome-extension://owned/agent-host.html',
    'chrome-extension://owned/popup.html?foreign',
  ]) {
    const denied = f.connect({ type: 'credential-clear', baseUrl: f.settings.baseUrl }, url);
    assert.equal(denied.port.closed, true);
    assert.deepEqual(denied.replies, []);
  }
  assert.equal(await f.repo.hasCredential(f.settings.baseUrl), true);
});

test('connection probing uses saved keys but never writes settings, skill sessions or recording evidence', async (t) => {
  const f = fixture({ skillRevision: 'existing-skill-state' });
  await f.repo.save(f.settings, 'SYNTHETIC');
  const before = structuredClone(f.local);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    calls++;
    assert.equal(new Headers(options.headers).get('authorization'), 'Bearer SYNTHETIC');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'fixture');
    assert.equal(body.messages.at(-1).content, 'Reply with OK only.');
    assert.ok(body.max_tokens <= 32);
    return completion();
  });
  const result = await f.connect({ type: 'test', settings: f.settings }).reply;
  assert.equal(result.ok, true);
  assert.equal(typeof result.value.elapsedMs, 'number');
  assert.equal(calls, 1);
  assert.deepEqual(f.local, before);
});

test('provider error bodies remain private and failed probes never retry or return success', async (t) => {
  const f = fixture();
  let status = 401;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return status === 200
      ? completion('')
      : Response.json({ error: { message: 'SYNTHETIC-SECRET' } }, { status });
  });
  for (const [code, error] of [
    [401, 'MODEL_AUTH'],
    [404, 'MODEL_NOT_FOUND'],
    [400, 'MODEL_CONFIGURATION'],
    [500, 'MODEL_UNAVAILABLE'],
    [429, 'MODEL_RATE_LIMIT'],
    [200, 'MODEL_EMPTY'],
  ]) {
    status = code;
    const result = await f.connect({ type: 'test', settings: f.settings, apiKey: 'SYNTHETIC-SECRET' }).reply;
    assert.deepEqual(result, { ok: false, error });
  }
  assert.equal(calls, 6);
});

test('closing the requesting Popup aborts its pending provider call and suppresses late feedback', async (t) => {
  const f = fixture();
  let entered;
  let cancelled;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const aborted = new Promise((resolve) => {
    cancelled = resolve;
  });
  t.mock.method(
    globalThis,
    'fetch',
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          'abort',
          () => {
            cancelled();
            reject(new DOMException('cancelled', 'AbortError'));
          },
          { once: true }
        );
        entered();
      })
  );
  const request = f.connect({ type: 'test', settings: f.settings, apiKey: '' });
  await started;
  request.port.disconnect();
  await aborted;
  await setImmediate();
  assert.deepEqual(request.replies, []);
  assert.equal(f.local.skillRevision, undefined);
});

test('connection deadlines return a visible timeout instead of leaving the Popup pending', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  t.mock.method(
    globalThis,
    'fetch',
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), {
          once: true,
        });
        entered();
      })
  );
  const request = f.connect({ type: 'test', settings: f.settings, apiKey: '' });
  await started;
  t.mock.timers.tick(30000);
  assert.deepEqual(await request.reply, { ok: false, error: 'MODEL_TIMEOUT' });
  assert.equal(request.port.closed, false);
});

test('one settings save commits credentials, consent and limits together or leaves all unchanged', async () => {
  const f = fixture();
  const request = {
    type: 'settings-save',
    settings: f.settings,
    apiKey: 'SYNTHETIC',
    consent: true,
    limits: { organize: 80, replay: 200, pageWaitSeconds: 20, pageWaitAttempts: 4 },
  };
  assert.equal((await f.connect(request).reply).ok, true);
  assert.deepEqual(f.local.skillExecutionLimits, {
    organize: 80,
    replay: 200,
    pageWaitSeconds: 20,
    pageWaitAttempts: 4,
  });
  assert.equal(f.local.workflowSettings.model, 'fixture');
  assert.equal(await f.repo.canSend(f.settings.baseUrl), true);
  const before = structuredClone(f.local);
  assert.equal(
    (
      await f.connect({
        ...request,
        settings: { ...f.settings, model: 'must-not-save' },
        limits: { organize: 0, replay: 501 },
      }).reply
    ).ok,
    false
  );
  assert.deepEqual(f.local, before);
  f.state.failWrite = true;
  assert.equal(
    (
      await f.connect({
        ...request,
        settings: { ...f.settings, model: 'also-must-not-save' },
        limits: { organize: 99, replay: 299 },
      }).reply
    ).ok,
    false
  );
  assert.deepEqual(f.local, before);
});

test('settings snapshots are public and stale concurrent saves cannot overwrite newer configuration', async () => {
  const f = fixture();
  const initial = (await f.connect({ type: 'settings-snapshot' }).reply).value;
  const results = await Promise.all([
    f.connect({
      type: 'settings-save',
      limits: { organize: 55, replay: 110 },
      settings: f.settings,
      apiKey: 'SECRET_FIXTURE',
      consent: true,
      expectedRevision: initial.revision,
    }).reply,
    f.connect({
      type: 'settings-save',
      limits: { organize: 55, replay: 110 },
      settings: { ...f.settings, model: 'conflicting' },
      consent: false,
      expectedRevision: initial.revision,
    }).reply,
  ]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.find((result) => !result.ok).error, 'SETTINGS_CONFLICT');
  const snapshot = (await f.connect({ type: 'settings-snapshot' }).reply).value;
  assert.equal(snapshot.settings.model, 'fixture');
  assert.equal(snapshot.hasKey, true);
  assert.equal(snapshot.canSend, true);
  assert.equal(JSON.stringify(snapshot).includes('SECRET_FIXTURE'), false);
  assert.deepEqual(snapshot.limits, { organize: 55, replay: 110, pageWaitSeconds: 15, pageWaitAttempts: 3 });
});
