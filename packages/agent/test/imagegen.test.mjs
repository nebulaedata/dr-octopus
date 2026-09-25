/**
 * @author Codex
 * @description Exercises image configuration, provider payloads, cancellation and durable file publication.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, readdir, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent';
import { readImagegenConfig, saveImagegenConfig } from '../dist/extensions/imagegen/lib/configuration.js';
import { generateDirectImages } from '../dist/extensions/imagegen/lib/providers.js';
import { imageHttpError } from '../dist/extensions/imagegen/lib/diagnostics.js';
import { getImagegenCatalog } from '../dist/extensions/imagegen/lib/catalog.js';
import {
  publishImages,
  readImageReferences,
  resolveImagePath,
} from '../dist/extensions/imagegen/lib/files.js';
import { generateImage } from '../dist/extensions/imagegen/services/imagegen-service.js';
import { createImagegenExtension } from '../dist/extensions/imagegen/index.js';

const config = { providerId: 'openai', modelId: 'gpt-image-1', adapter: 'openai-images' };
const png = await sharp({ create: { width: 2, height: 3, channels: 3, background: '#ff0000' } })
  .png()
  .toBuffer();
const image = { type: 'image', data: png.toString('base64'), mimeType: 'image/png' };
const model = {
  id: 'gpt-image-1',
  name: 'image',
  provider: 'openai',
  api: 'openai-images',
  baseUrl: 'https://example.test/v1',
  input: ['text', 'image'],
  output: ['image'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

/**
 * Creates an isolated workspace and removes only the owned temporary directory.
 */
async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'octopus-imagegen-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  return cwd;
}

/**
 * Supplies provider metadata and resolved credentials without real accounts.
 */
function registry(models = [], oauth = false) {
  return {
    getAll: () => models,
    getProvider: (id) =>
      ['openai', 'google', 'openrouter', 'custom'].includes(id)
        ? { id, name: id, baseUrl: 'https://example.test/v1', auth: {} }
        : undefined,
    getRegisteredProviderConfig: () => undefined,
    getProviderAuthStatus: () => ({ configured: true }),
    isUsingOAuth: () => oauth,
    find: (provider, id) => models.find((model) => model.provider === provider && model.id === id),
    refresh: async () => ({ aborted: false, errors: new Map() }),
    getError: () => undefined,
    getApiKeyAndHeaders: async () => ({ ok: true, apiKey: 'fixture-key' }),
    getApiKeyForProvider: async () => 'fixture-key',
  };
}

test('image defaults are independent, atomic, clearable and reject corrupt documents', async (t) => {
  const cwd = await fixture(t);
  assert.equal(await readImagegenConfig(cwd), null);
  await writeFile(join(cwd, 'settings.json'), '{"defaultModel":"chat"}');
  await Promise.all(
    Array.from({ length: 8 }, (_, index) => saveImagegenConfig(cwd, { ...config, modelId: `image-${index}` }))
  );
  assert.match((await readImagegenConfig(cwd)).modelId, /^image-/);
  assert.equal(await readFile(join(cwd, 'settings.json'), 'utf8'), '{"defaultModel":"chat"}');
  await saveImagegenConfig(cwd, null);
  assert.equal(await readImagegenConfig(cwd), null);
  assert.deepEqual(
    (await readdir(cwd)).filter((name) => name.endsWith('.tmp')),
    []
  );
  await writeFile(join(cwd, 'imagegen.json'), '{}');
  await assert.rejects(readImagegenConfig(cwd));
});

test('OpenAI generation and edits use separate endpoints and carry all references', async () => {
  const calls = [];
  const options = {
    apiKey: 'fixture-key',
    fetch: async (url, init) => {
      calls.push({ url, init });
      return Response.json({
        data: [{ b64_json: image.data }],
        usage: { input_tokens: 4, output_tokens: 8 },
      });
    },
  };
  const generated = await generateDirectImages(
    model,
    { input: [{ type: 'text', text: 'Draw a cat' }] },
    options
  );
  assert.equal(calls[0].url, 'https://example.test/v1/images/generations');
  assert.equal(JSON.parse(calls[0].init.body).prompt, 'Draw a cat');
  assert.equal(generated.output[0].data, image.data);
  assert.equal(generated.usage.totalTokens, 12);
  await generateDirectImages(
    model,
    { input: [{ type: 'text', text: 'Make it blue' }, image, image] },
    options
  );
  assert.equal(calls[1].url, 'https://example.test/v1/images/edits');
  assert.equal(calls[1].init.body.getAll('image[]').length, 2);
  assert.equal(calls[1].init.headers.has('content-type'), false);
});

test('Gemini requests image output and preserves ordered text and reference parts', async () => {
  let request;
  const result = await generateDirectImages(
    { ...model, provider: 'google', api: 'google-gemini', baseUrl: 'https://example.test/v1beta' },
    { input: [{ type: 'text', text: 'Edit' }, image] },
    {
      apiKey: 'key',
      fetch: async (url, init) => {
        request = { url, init };
        return Response.json({
          candidates: [
            {
              content: {
                parts: [{ text: 'Done' }, { inlineData: { data: image.data, mimeType: 'image/png' } }],
              },
            },
          ],
        });
      },
    }
  );
  assert.equal(request.url, 'https://example.test/v1beta/models/gpt-image-1:generateContent');
  const body = JSON.parse(request.init.body);
  assert.deepEqual(body.generationConfig.responseModalities, ['TEXT', 'IMAGE']);
  assert.equal(body.contents[0].parts[1].inlineData.data, image.data);
  assert.equal(result.output[1].type, 'image');
});

test('image model headers are preserved and request-level null values suppress defaults', async () => {
  let headers;
  await generateDirectImages(
    { ...model, headers: { 'x-provider-project': 'project', 'x-remove': 'default' } },
    { input: [{ type: 'text', text: 'Draw' }] },
    {
      headers: { 'x-remove': null },
      fetch: async (_url, init) => {
        headers = init.headers;
        return Response.json({ data: [{ b64_json: image.data }] });
      },
    }
  );
  assert.equal(headers.get('x-provider-project'), 'project');
  assert.equal(headers.has('x-remove'), false);
});

test('provider failures are not retried or allowed to leak response bodies', async () => {
  let count = 0;
  await assert.rejects(
    generateDirectImages(
      model,
      { input: [{ type: 'text', text: 'Draw' }] },
      {
        fetch: async () => {
          count++;
          return new Response('secret upstream credential', { status: 429 });
        },
      }
    ),
    /HTTP 429/
  );
  assert.equal(count, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    generateDirectImages(
      model,
      { input: [] },
      {
        signal: controller.signal,
        fetch: async (_url, init) => {
          init.signal.throwIfAborted();
        },
      }
    ),
    { name: 'AbortError' }
  );
});

test('edit failures retain sanitized provider diagnostics through Pi without retrying or publishing', async (t) => {
  const cwd = await fixture(t);
  await saveImagegenConfig(cwd, config);
  await writeFile(join(cwd, 'reference.png'), png);
  const oldFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = oldFetch;
  });
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    assert.match(String(url), /images\/edits$/);
    return Response.json(
      {
        error: {
          code: 'invalid_image_field',
          type: 'invalid_request_error',
          param: 'image',
          message: `Expected image field; fixture-key; private prompt; ${image.data}; https://example.test/?token=private`,
          internal: 'must not be included',
        },
      },
      { status: 400, headers: { 'x-request-id': 'req-edit-fixture' } }
    );
  };
  await assert.rejects(
    generateImage({
      agentDir: cwd,
      cwd,
      registry: registry(),
      prompt: 'private prompt',
      referenceImages: ['reference.png'],
    }),
    (error) => {
      for (const expected of [
        'HTTP 400',
        'reference edit',
        'invalid_image_field',
        'param=image',
        'req-edit-fixture',
        'Expected image field',
      ])
        assert.ok(error.message.includes(expected), error.message);
      for (const secret of [
        'fixture-key',
        'private prompt',
        image.data,
        'token=private',
        'must not be included',
      ])
        assert.equal(error.message.includes(secret), false);
      return true;
    }
  );
  assert.equal(calls, 1);
  assert.equal((await readdir(cwd)).includes('generated-images'), false);
});

test('diagnostics bound malformed and oversized bodies, cancel streams and retain status', async () => {
  for (const body of [
    '<html>secret</html>',
    'null',
    JSON.stringify({ error: { message: 'x'.repeat(17000) } }),
  ]) {
    const error = await imageHttpError(
      new Response(body, { status: 502, headers: { 'x-request-id': 'req-502' } }),
      []
    );
    assert.match(error.message, /HTTP 502/);
    assert.match(error.message, /req-502/);
    assert.doesNotMatch(error.message, /secret|xxx/);
  }
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(17000));
      },
      cancel() {
        cancelled = true;
      },
    }),
    { status: 413 }
  );
  assert.match((await imageHttpError(response, [])).message, /HTTP 413/);
  assert.equal(cancelled, true);
  const error = await imageHttpError(
    Response.json(
      { error: { message: `Bearer hidden-token sk-private-key ${'word '.repeat(1000)}` } },
      { status: 401 }
    ),
    []
  );
  assert.ok(error.message.length <= 2048);
  assert.doesNotMatch(error.message, /hidden-token|sk-private-key/);
});

test('reference validation and concurrent publication retain correct paths and dimensions', async (t) => {
  const cwd = await fixture(t);
  await writeFile(join(cwd, 'source.png'), png);
  assert.equal((await readImageReferences(cwd, ['source.png']))[0].data, image.data);
  const results = await Promise.all([
    publishImages(cwd, 'generated-images', [image]),
    publishImages(cwd, 'generated-images', [image]),
  ]);
  assert.notEqual(results[0][0].path, results[1][0].path);
  assert.equal(results[0][0].width, 2);
  assert.equal(results[0][0].height, 3);
  assert.deepEqual(await readFile(results[0][0].path), png);
  await assert.rejects(readImageReferences(cwd, Array(5).fill('source.png')), /four/);
  await assert.rejects(resolveImagePath(cwd, '../outside.png'), /workspace/);
  await writeFile(join(cwd, 'bad.png'), 'not an image');
  await assert.rejects(readImageReferences(cwd, ['bad.png']));
});

test('invalid outputs and cancellation leave no partial images', async (t) => {
  const cwd = await fixture(t);
  await assert.rejects(publishImages(cwd, 'output', [image, { ...image, data: 'invalid' }]));
  assert.deepEqual(await readdir(cwd), []);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(publishImages(cwd, 'output', [image], controller.signal));
  assert.deepEqual(await readdir(cwd), []);
});

test('catalog distinguishes explicit custom capabilities, native images and OAuth incompatibility', async (t) => {
  const cwd = await fixture(t);
  const customModel = { ...model, provider: 'custom', id: 'custom-image' };
  await writeFile(
    join(cwd, 'models.json'),
    JSON.stringify({
      providers: { custom: {} },
      octopusModelCapabilities: { custom: { 'custom-image': { imageGeneration: true } } },
    })
  );
  const catalog = await getImagegenCatalog(cwd, registry([customModel]));
  const custom = catalog.find((entry) => entry.candidate.providerId === 'custom');
  assert.equal(custom.candidate.requiresProtocolConfirmation, true);
  assert.equal(custom.candidate.adapter, 'openai-images');
  assert.equal(
    catalog.find((entry) => entry.candidate.providerId === 'openai').candidate.requiresProtocolConfirmation,
    false
  );
  assert.ok((await getImagegenCatalog(cwd, registry([], true))).every((entry) => !entry.candidate.available));
  await writeFile(
    join(cwd, 'models.json'),
    JSON.stringify({
      providers: { custom: {} },
      octopusModelCapabilities: { custom: { 'custom-image': { imageGeneration: false } } },
    })
  );
  assert.equal(
    (await getImagegenCatalog(cwd, registry([customModel]))).some(
      (entry) => entry.candidate.providerId === 'custom'
    ),
    false
  );
});

test('tool reloads defaults, publishes usable receipts and fails on empty provider output', async (t) => {
  const cwd = await fixture(t);
  await mkdir(join(cwd, 'agent'));
  const agentDir = join(cwd, 'agent');
  await assert.rejects(
    generateImage({ agentDir, cwd, registry: registry(), prompt: 'cat' }),
    /Configure an image model/
  );
  await saveImagegenConfig(agentDir, config);
  const oldFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = oldFetch;
  });
  globalThis.fetch = async () => Response.json({ data: [{ b64_json: image.data }] });
  const result = await generateImage({ agentDir, cwd, registry: registry(), prompt: 'cat' });
  assert.equal(result.details.version, 1);
  assert.ok(result.details.images[0].relativePath.startsWith('generated-images/'));
  assert.equal(JSON.stringify(result.details).includes(image.data), false);
  globalThis.fetch = async () => Response.json({ data: [] });
  await assert.rejects(
    generateImage({ agentDir, cwd, registry: registry(), prompt: 'cat' }),
    /number of images/
  );
  await saveImagegenConfig(agentDir, null);
  await assert.rejects(generateImage({ agentDir, cwd, registry: registry(), prompt: 'cat' }), /Configure/);
});

test('inline extension registers one tool without starting session resources', () => {
  const tools = [];
  createImagegenExtension('unused')({ registerTool: (tool) => tools.push(tool) });
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['image_generate']
  );
});

test('the public Pi loader loads imagegen without credentials or filesystem initialization', async (t) => {
  const cwd = await fixture(t);
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: cwd,
    settingsManager: SettingsManager.inMemory(),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [{ name: 'octopus-imagegen', factory: createImagegenExtension(cwd) }],
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  assert.ok(loader.getExtensions().extensions.some((extension) => extension.tools.has('image_generate')));
  assert.equal(await readImagegenConfig(cwd), null);
});

test('a failed provider refresh never executes against stale configuration', async (t) => {
  const cwd = await fixture(t);
  await saveImagegenConfig(cwd, config);
  const models = registry();
  models.refresh = async () => ({
    aborted: false,
    errors: new Map([['openai', new Error('invalid config')]]),
  });
  await assert.rejects(
    generateImage({ agentDir: cwd, cwd, registry: models, prompt: 'cat' }),
    /Unable to refresh/
  );
  assert.deepEqual(
    (await readdir(cwd)).filter((name) => name === 'generated-images'),
    []
  );
});

test('OpenRouter uses the Pi adapter for reference images without provider retries', async (t) => {
  const cwd = await fixture(t);
  const candidate = (await getImagegenCatalog(cwd, registry())).find(
    (entry) => entry.candidate.adapter === 'openrouter' && entry.candidate.supportsReferenceImages
  ).candidate;
  await saveImagegenConfig(cwd, {
    providerId: candidate.providerId,
    modelId: candidate.modelId,
    adapter: candidate.adapter,
  });
  await writeFile(join(cwd, 'reference.png'), png);
  const oldFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = oldFetch;
  });
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(init.body);
    assert.ok(
      body.messages.some(
        (message) =>
          Array.isArray(message.content) && message.content.some((part) => part.type === 'image_url')
      )
    );
    return Response.json({
      id: 'image-fixture',
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Done',
            images: [{ image_url: { url: `data:image/png;base64,${image.data}` } }],
          },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  };
  const result = await generateImage({
    agentDir: cwd,
    cwd,
    registry: registry(),
    prompt: 'Edit this',
    referenceImages: ['reference.png'],
  });
  assert.equal(result.details.images.length, 1);
  assert.equal(calls, 1);
});
