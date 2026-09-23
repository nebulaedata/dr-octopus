/**
 * @author Codex
 * @description Verify Jev settings HTTP redaction, validation, probe admission and revision conflicts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify from 'fastify';
import autoload from '@fastify/autoload';
import { fileURLToPath } from 'node:url';
import { MemoryService } from '../dist/modules/memory/memory.service.js';
import { registerMemoryController } from '../dist/modules/memory/memory.controller.js';
import { JevSettingsService } from '../dist/modules/jev-settings/jev-settings.service.js';
import {
  registerJevController,
  registerJevErrors,
  jevErrorMessages,
} from '../dist/modules/jev-settings/jev-settings.controller.js';

test('Jev connection settings redact the key, reject stale writes and require a key for probing', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'jev-http-'));
  const app = Fastify();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  registerJevErrors();
  registerJevController(app, new JevSettingsService(root, {}));
  const initial = await app.inject('/settings/jev');
  assert.equal(initial.headers['cache-control'], 'no-store');
  assert.equal(initial.json().model, 'jev-1.13.0');
  assert.equal('memory' in initial.json(), false);
  assert.equal((await app.inject({ method: 'POST', url: '/settings/jev/probe' })).statusCode, 400);
  assert.equal((await app.inject('/settings/jev/models')).statusCode, 400);
  const { revision, model } = initial.json();
  const input = { revision, model };
  const credential = { revision: initial.json().environmentRevision, apiKey: 'http-private-key' };
  const keySaved = await app.inject({
    method: 'PATCH',
    url: '/settings/jev/credential',
    payload: credential,
  });
  assert.equal(keySaved.statusCode, 200);
  assert.equal(keySaved.json().hasApiKey, true);
  assert.ok(!keySaved.body.includes('http-private-key'));
  assert.equal(
    (await app.inject({ method: 'PATCH', url: '/settings/jev/credential', payload: credential })).statusCode,
    409
  );
  const payload = { ...input, model: 'jev-latest' };
  const saved = await app.inject({ method: 'PUT', url: '/settings/jev', payload });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().hasApiKey, true);
  assert.ok(!saved.body.includes('http-private-key'));
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url, options) => {
    if (url === 'https://api.typesafe.ai/v1/models') {
      assert.equal(new Headers(options.headers).get('authorization'), 'Bearer http-private-key');
      return Response.json({ models: [{ name: 'jev-latest' }] });
    }
    assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(new Headers(options.headers).get('authorization'), 'Bearer http-private-key');
    assert.equal(JSON.parse(options.body).state, 'Hello!');
    return Response.json({
      model: 'jev-1.13.0',
      answers: {
        decision: {
          type: 'choice',
          choice: 'greeting',
          probabilities: { greeting: 1, other: 0 },
          confidence: 1,
        },
      },
    });
  };
  const models = await app.inject('/settings/jev/models');
  assert.equal(models.statusCode, 200);
  assert.equal(models.headers['cache-control'], 'no-store');
  assert.deepEqual(models.json(), ['jev-latest']);
  const probe = await app.inject({ method: 'POST', url: '/settings/jev/probe' });
  assert.equal(probe.statusCode, 200);
  assert.equal(probe.json().model, 'jev-1.13.0');
  const cleared = await app.inject({
    method: 'PATCH',
    url: '/settings/jev/credential',
    payload: { revision: keySaved.json().environmentRevision, apiKey: null },
  });
  assert.equal(cleared.statusCode, 200);
  assert.equal(cleared.json().hasApiKey, false);
  assert.equal((await app.inject({ method: 'POST', url: '/settings/jev/probe' })).statusCode, 400);
  assert.ok(!probe.body.includes('http-private-key'));
  assert.equal((await app.inject({ method: 'PUT', url: '/settings/jev', payload })).statusCode, 409);
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: '/settings/jev',
        payload: { ...payload, endpoint: 'https://unexpected.example' },
      })
    ).statusCode,
    400
  );
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: '/settings/jev',
        payload: { ...payload, memory: { enabled: true, skipThreshold: 0.5 } },
      })
    ).statusCode,
    400
  );
});

test('every Jev error has exactly one bilingual generic message', () => {
  for (const [code, entry] of Object.entries(jevErrorMessages)) {
    const variants = Array.isArray(entry) ? entry : [entry];
    const generic = variants.filter((variant) => variant.match === undefined);
    assert.equal(generic.length, 1, code);
    assert.ok(generic[0].en.length > 0, code);
    assert.ok(generic[0]['zh-CN'].length > 0, code);
  }
});

test('Jev autoload entry publishes only the API routes and does not create settings on startup', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'jev-plugin-'));
  const app = Fastify();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  await app.register(autoload, {
    dir: fileURLToPath(new URL('../dist/modules/jev-settings/', import.meta.url)),
    options: { config: { agentDir: root } },
  });
  const result = await app.inject('/api/settings/jev');
  assert.equal(result.statusCode, 200);
  assert.equal(result.json().model, 'jev-1.13.0');
  assert.equal((await app.inject('/settings/jev')).statusCode, 404);
  assert.deepEqual(await readdir(root), []);
});

test('memory screening routes own default-off policy and never modify Jev settings', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'memory-screen-http-'));
  const app = Fastify();
  const service = new MemoryService({ dataRoot: root });
  t.after(async () => {
    await app.close();
    await service.close();
    await rm(root, { recursive: true, force: true });
  });
  registerMemoryController(app, service);
  const initial = await app.inject('/memory/screening');
  assert.equal(initial.statusCode, 200);
  assert.equal(initial.json().enabled, false);
  const payload = { ...initial.json(), enabled: true };
  const saved = await app.inject({ method: 'PUT', url: '/memory/screening', payload });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().enabled, true);
  assert.equal((await app.inject({ method: 'PUT', url: '/memory/screening', payload })).statusCode, 409);
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: '/memory/screening',
        payload: { ...saved.json(), timeoutMs: 5 },
      })
    ).statusCode,
    400
  );
  assert.deepEqual(await readdir(root), ['memory']);
});
