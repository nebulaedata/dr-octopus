/**
 * @author Codex
 * @description Checks bounded credential-free model metadata results and explicit no-retry transport behavior.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/model-settings/model-discovery.ts', import.meta.url))],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
});
const module = { exports: {} };
new Function('require', 'module', 'exports', outputFiles[0].text)(require, module, module.exports);
const { discoverModels } = module.exports;

test('discovery uses the configured base path, omits cookies and returns only deduplicated IDs', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++;
    assert.equal(url, 'http://provider.example/v1/models');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-key');
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    return Response.json({ data: [{ id: 'b', private: 'excluded' }, { id: 'a' }, { id: 'b' }] });
  });
  assert.deepEqual(
    await discoverModels('http://provider.example/v1/', 'synthetic-key', new AbortController().signal),
    ['a', 'b']
  );
  assert.equal(calls, 1);
});

test('invalid metadata and HTTP errors are redacted and never retried', async (t) => {
  const replies = [
    Response.json({ error: 'synthetic-secret' }, { status: 401 }),
    Response.json({ data: [{ id: '' }] }),
    new Response('synthetic-secret'),
    Response.json({ data: Array.from({ length: 2001 }, () => ({ id: 'a' })) }),
  ];
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => replies[calls++]);
  for (let index = 0; index < replies.length; index++) {
    await assert.rejects(discoverModels('https://provider.example/v1', '', new AbortController().signal), {
      message: 'MODEL_LIST_FAILED',
    });
    assert.equal(calls, index + 1);
  }
});

test('oversized responses stop reading and cancellation stays distinct from provider failure', async (t) => {
  let cancelled = false;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    if (options.signal.aborted) {
      throw new Error('private body');
    }
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(1024 * 1024 + 1));
        },
        cancel() {
          cancelled = true;
        },
      })
    );
  });
  await assert.rejects(discoverModels('https://provider.example', '', new AbortController().signal), {
    message: 'MODEL_LIST_FAILED',
  });
  assert.equal(cancelled, true);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(discoverModels('https://provider.example', '', controller.signal), {
    message: 'MODEL_LIST_CANCELLED',
  });
});
