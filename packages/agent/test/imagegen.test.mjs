/**
 * @author Codex
 * @description Exercises image configuration, provider payloads, cancellation and durable file publication.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, readdir, rm, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  DefaultResourceLoader,
  ModelRuntime,
  SettingsManager,
  SessionManager,
  createAgentSession,
} from '@earendil-works/pi-coding-agent';
import {
  readImagegenConfig,
  readImagegenSettings,
  updateImagegenSettings,
} from '../dist/extensions/imagegen/lib/configuration.js';
import { generateDirectImages } from '../dist/extensions/imagegen/lib/providers.js';
import { imageHttpError } from '../dist/extensions/imagegen/lib/diagnostics.js';
import {
  publishImages,
  readImageReferences,
  resolveImagePath,
} from '../dist/extensions/imagegen/lib/files.js';
import { generateImage } from '../dist/extensions/imagegen/services/imagegen-service.js';
import { createImagegenExtension } from '../dist/extensions/imagegen/index.js';

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
 * Configures an isolated image service without any conversation model or registry.
 */
async function configureImages(directory, id = 'openai') {
  const current = await readImagegenSettings(directory);
  return updateImagegenSettings(directory, {
    revision: current.revision,
    enabled: true,
    activeProvider: id,
    provider: {
      id,
      baseUrl: 'https://example.test/v1',
      model: id === 'openai' ? 'gpt-image-1' : 'qwen-image-3.0-pro',
      apiKey: 'fixture-key',
    },
  });
}

test('image services are independent, redact keys, fence concurrent writes and reject corrupt documents', async (t) => {
  const cwd = await fixture(t);
  const initial = await readImagegenSettings(cwd);
  assert.equal(initial.enabled, false);
  await writeFile(join(cwd, 'settings.json'), '{"defaultModel":"chat"}');
  const saved = await configureImages(cwd);
  assert.equal(saved.providers.openai.hasApiKey, true);
  assert.equal(JSON.stringify(saved).includes('fixture-key'), false);
  const updates = await Promise.allSettled(
    Array.from({ length: 2 }, () => updateImagegenSettings(cwd, { revision: saved.revision, enabled: false }))
  );
  assert.equal(updates.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(updates.find((result) => result.status === 'rejected').reason.code, 'IMAGEGEN_CONFLICT');
  assert.equal(await readFile(join(cwd, 'settings.json'), 'utf8'), '{"defaultModel":"chat"}');
  const off = await readImagegenSettings(cwd);
  const qwen = await updateImagegenSettings(cwd, {
    revision: off.revision,
    provider: {
      id: 'qwen',
      baseUrl: 'https://example.test/api/v1',
      model: 'qwen-image-3.0-pro',
      apiKey: 'qwen-key',
    },
  });
  assert.equal(qwen.activeProvider, 'openai', 'saving a provider does not activate it');
  assert.equal((await readImagegenConfig(cwd)).providers.openai.apiKey, 'fixture-key');
  const cleared = await updateImagegenSettings(cwd, {
    revision: qwen.revision,
    provider: {
      id: 'qwen',
      baseUrl: qwen.providers.qwen.baseUrl,
      model: qwen.providers.qwen.model,
      apiKey: null,
    },
  });
  assert.equal(cleared.providers.qwen.hasApiKey, false);
  await assert.rejects(
    updateImagegenSettings(cwd, { revision: cleared.revision, activeProvider: 'qwen', enabled: true }),
    { code: 'IMAGEGEN_KEY_REQUIRED' }
  );
  assert.deepEqual(
    (await readdir(cwd)).filter((name) => name.endsWith('.tmp')),
    []
  );
  await writeFile(join(cwd, 'imagegen.json'), '{}');
  await assert.rejects(readImagegenConfig(cwd), { code: 'IMAGEGEN_INVALID' });
  await writeFile(join(cwd, 'imagegen.json'), '{"apiKey":"private-key", broken');
  await assert.rejects(readImagegenConfig(cwd), { message: 'IMAGEGEN_INVALID' });
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

test('Qwen uses DashScope messages for generation and reference editing without sending keys to image URLs', async () => {
  for (const references of [[], [image, image]]) {
    const calls = [];
    const result = await generateDirectImages(
      {
        ...model,
        id: 'qwen-image-3.0-pro',
        provider: 'qwen',
        api: 'qwen-images',
        baseUrl: 'https://example.test/api/v1',
      },
      { input: [{ type: 'text', text: 'Draw' }, ...references] },
      {
        apiKey: 'key',
        fetch: async (url, init) => {
          calls.push({ url: String(url), init });
          if (calls.length === 1)
            return Response.json({
              output: {
                choices: [
                  { message: { content: [{ image: 'https://images.test/result.png' }, { text: 'Done' }] } },
                ],
              },
            });
          return new Response(png);
        },
      }
    );
    assert.equal(calls[0].url, 'https://example.test/api/v1/services/aigc/multimodal-generation/generation');
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.input.messages[0].content.length, references.length + 1);
    assert.equal(body.input.messages[0].content.at(-1).text, 'Draw');
    if (references.length)
      assert.equal(body.input.messages[0].content[0].image, `data:image/png;base64,${image.data}`);
    assert.equal(calls[1].init.headers, undefined);
    assert.equal(result.output[0].data, image.data);
  }
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
  await configureImages(cwd);
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

test('image settings reject unsupported document formats without fallback', async (t) => {
  const cwd = await fixture(t);
  for (const value of [null, { providerId: 'custom', modelId: 'image', adapter: 'openai-images' }]) {
    await writeFile(join(cwd, 'imagegen.json'), JSON.stringify(value));
    await assert.rejects(readImagegenSettings(cwd), { code: 'IMAGEGEN_INVALID' });
    await assert.rejects(generateImage({ agentDir: cwd, cwd, prompt: 'cat' }), { code: 'IMAGEGEN_INVALID' });
  }
});

test('tool reloads defaults, publishes usable receipts and fails on empty provider output', async (t) => {
  const cwd = await fixture(t);
  await mkdir(join(cwd, 'agent'));
  const agentDir = join(cwd, 'agent');
  await assert.rejects(generateImage({ agentDir, cwd, prompt: 'cat' }), /Image service/);
  await configureImages(agentDir);
  const oldFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = oldFetch;
  });
  globalThis.fetch = async () => Response.json({ data: [{ b64_json: image.data }] });
  const result = await generateImage({ agentDir, cwd, prompt: 'cat' });
  assert.equal(result.details.version, 1);
  assert.ok(result.details.images[0].relativePath.startsWith('generated-images/'));
  assert.equal(JSON.stringify(result.details).includes(image.data), false);
  globalThis.fetch = async () => Response.json({ data: [] });
  await assert.rejects(generateImage({ agentDir, cwd, prompt: 'cat' }), /no images/);
  await updateImagegenSettings(agentDir, {
    revision: (await readImagegenSettings(agentDir)).revision,
    enabled: false,
  });
  await assert.rejects(generateImage({ agentDir, cwd, prompt: 'cat' }), /Image service/);
});

test('inline extension registers one tool without starting session resources', () => {
  const tools = [];
  createImagegenExtension('unused')({ registerTool: (tool) => tools.push(tool), on() {} });
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
  assert.equal((await readImagegenConfig(cwd)).enabled, false);
});

test('each call reads fresh image configuration and rejects invalid or excessive Qwen references before transport', async (t) => {
  const cwd = await fixture(t);
  await configureImages(cwd, 'qwen');
  await writeFile(join(cwd, 'reference.png'), png);
  await assert.rejects(
    generateImage({ agentDir: cwd, cwd, prompt: 'Edit', referenceImages: Array(4).fill('reference.png') }),
    /up to 3/
  );
  const oldFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = oldFetch;
  });
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    if (calls === 1) {
      assert.equal(JSON.parse(init.body).model, 'qwen-image-3.0-pro');
      return Response.json({
        output: { choices: [{ message: { content: [{ image: 'https://images.test/result.png' }] } }] },
      });
    }
    return new Response(png);
  };
  const result = await generateImage({
    agentDir: cwd,
    cwd,
    prompt: 'Edit',
    referenceImages: ['reference.png'],
  });
  assert.equal(result.details.providerId, 'qwen');
  assert.equal(result.details.images.length, 1);
  assert.equal(calls, 2);
  await writeFile(join(cwd, 'imagegen.json'), '{}');
  await assert.rejects(generateImage({ agentDir: cwd, cwd, prompt: 'cat' }));
  assert.equal(calls, 2, 'invalid current settings never fall back to cached credentials');
});

/**
 * Parses the serialized multipart request so tests cover wire encoding, not only FormData entries.
 */
async function parseImageMultipart(url, init) {
  const request = new Request(url, init);
  assert.match(request.headers.get('content-type'), /^multipart\/form-data; boundary=/);
  return request.formData();
}

for (const modelId of ['gpt-image-2', 'gpt-image-1.5']) {
  test(`${modelId} preserves its model ID and binary references through multipart encoding`, async () => {
    const formats = [
      { bytes: png, mimeType: 'image/png', extension: 'png' },
      { bytes: await sharp(png).jpeg().toBuffer(), mimeType: 'image/jpeg', extension: 'jpeg' },
      { bytes: await sharp(png).webp().toBuffer(), mimeType: 'image/webp', extension: 'webp' },
    ];
    for (const referenceCount of [1, 4]) {
      const references = Array.from(
        { length: referenceCount },
        (_, index) => formats[index % formats.length]
      );
      let calls = 0;
      const result = await generateDirectImages(
        { ...model, id: modelId, baseUrl: 'https://example.test/v1/' },
        {
          input: [
            { type: 'text', text: 'Change to a portrait wallpaper' },
            ...references.map((reference) => ({
              type: 'image',
              mimeType: reference.mimeType,
              data: reference.bytes.toString('base64'),
            })),
          ],
        },
        {
          apiKey: 'fixture-key',
          fetch: async (url, init) => {
            calls++;
            assert.equal(url, 'https://example.test/v1/images/edits');
            assert.equal(init.method, 'POST');
            assert.equal(init.headers.get('authorization'), 'Bearer fixture-key');
            const form = await parseImageMultipart(url, init);
            assert.equal(form.get('model'), modelId);
            assert.equal(form.get('prompt'), 'Change to a portrait wallpaper');
            assert.equal(form.has('input_fidelity'), false, 'GPT Image 2 must not receive input_fidelity');
            const uploads = form.getAll('image[]');
            assert.equal(uploads.length, referenceCount);
            for (const [index, upload] of uploads.entries()) {
              assert.equal(upload.type, references[index].mimeType);
              assert.equal(upload.name, `reference-${index}.${references[index].extension}`);
              assert.deepEqual(Buffer.from(await upload.arrayBuffer()), references[index].bytes);
            }
            return Response.json({ data: [{ b64_json: image.data }] });
          },
        }
      );
      assert.equal(calls, 1);
      assert.equal(result.model, modelId);
      assert.equal(result.output[0].data, image.data);
    }
  });
}

for (const modelId of [
  'qwen-image-2.0-pro',
  'qwen-image-3.0-pro',
  'qwen-image-edit',
  'qwen-image-edit-plus',
  'qwen-image-edit-max',
]) {
  test(`${modelId} edits three references through the configured service and publishes a receipt`, async (t) => {
    const cwd = await fixture(t);
    await configureImages(cwd, 'qwen');
    const current = await readImagegenSettings(cwd);
    await updateImagegenSettings(cwd, {
      revision: current.revision,
      provider: { id: 'qwen', baseUrl: 'https://example.test/api/v1/', model: modelId },
    });
    const references = [png, await sharp(png).jpeg().toBuffer(), await sharp(png).webp().toBuffer()];
    const paths = ['input.png', 'input.jpg', 'input.webp'];
    for (const [index, path] of paths.entries()) await writeFile(join(cwd, path), references[index]);
    const oldFetch = globalThis.fetch;
    t.after(() => {
      globalThis.fetch = oldFetch;
    });
    let calls = 0;
    globalThis.fetch = async (url, init) => {
      calls++;
      if (calls === 1) {
        assert.equal(
          String(url),
          'https://example.test/api/v1/services/aigc/multimodal-generation/generation'
        );
        assert.equal(init.headers.get('authorization'), 'Bearer fixture-key');
        assert.equal(init.headers.get('content-type'), 'application/json');
        const body = JSON.parse(init.body);
        assert.equal(body.model, modelId);
        assert.deepEqual(body.parameters, { n: 1 });
        assert.deepEqual(body.input.messages, [
          {
            role: 'user',
            content: [
              ...references.map((bytes, index) => ({
                image: `data:${['image/png', 'image/jpeg', 'image/webp'][index]};base64,${bytes.toString('base64')}`,
              })),
              { text: 'Combine these images' },
            ],
          },
        ]);
        return Response.json({
          output: { choices: [{ message: { content: [{ image: 'https://images.test/edited.png' }] } }] },
        });
      }
      assert.equal(String(url), 'https://images.test/edited.png');
      assert.equal(init.headers, undefined);
      return new Response(png);
    };
    const result = await generateImage({
      agentDir: cwd,
      cwd,
      prompt: 'Combine these images',
      referenceImages: paths,
    });
    assert.equal(calls, 2);
    assert.equal(result.details.providerId, 'qwen');
    assert.equal(result.details.modelId, modelId);
    assert.deepEqual(await readFile(result.details.images[0].path), png);
    await assert.rejects(
      generateImage({ agentDir: cwd, cwd, prompt: 'Edit', referenceImages: [...paths, paths[0]] }),
      /up to 3/
    );
    assert.equal(calls, 2, 'invalid references must not reach the billed endpoint');
  });
}

test('GPT Image 2 field compatibility stops after one fallback and never falls back to generation', async (t) => {
  const cwd = await fixture(t);
  await configureImages(cwd);
  const current = await readImagegenSettings(cwd);
  await updateImagegenSettings(cwd, {
    revision: current.revision,
    provider: { id: 'openai', baseUrl: 'https://example.test/v1', model: 'gpt-image-2' },
  });
  await writeFile(join(cwd, 'reference.png'), png);
  const oldFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = oldFetch;
  });
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(String(url), 'https://example.test/v1/images/edits');
    const form = await parseImageMultipart(url, init);
    assert.equal(form.get('model'), 'gpt-image-2');
    return Response.json(
      { detail: [{ type: 'missing', loc: ['body', 'image'], msg: 'Field required' }] },
      { status: 422 }
    );
  };
  await assert.rejects(
    generateImage({ agentDir: cwd, cwd, prompt: 'Edit to portrait', referenceImages: ['reference.png'] }),
    (error) => {
      assert.match(error.message, /HTTP 422/);
      assert.match(error.message, /reference edit; model=gpt-image-2/);
      assert.match(error.message, /loc=body.image/);
      assert.match(error.message, /msg=Field required/);
      return true;
    }
  );
  assert.equal(calls, 2);
  assert.equal((await readdir(cwd)).includes('generated-images'), false);
});

test('HTTP 422 validation diagnostics retain field locations while excluding input, ctx and secrets', async () => {
  const error = await imageHttpError(
    Response.json(
      {
        detail: [
          {
            type: 'missing',
            loc: ['body', 'image', 0],
            msg: `Field required fixture-key private prompt ${image.data} https://example.test/?token=hidden`,
            input: { credential: 'unlisted-input-secret', image: image.data },
            ctx: { error: 'unlisted-context-secret' },
          },
        ],
      },
      { status: 422 }
    ),
    ['fixture-key', 'private prompt', image.data]
  );
  assert.match(error.message, /HTTP 422/);
  assert.match(error.message, /type=missing/);
  assert.match(error.message, /loc=body.image.0/);
  assert.match(error.message, /msg=Field required/);
  for (const secret of [
    'fixture-key',
    'private prompt',
    image.data,
    'token=hidden',
    'unlisted-input-secret',
    'unlisted-context-secret',
  ]) {
    assert.equal(error.message.includes(secret), false);
  }
});

test('validation diagnostics accept string and object details and bound malformed or excessive entries', async () => {
  for (const detail of [
    'Unsupported image field',
    { type: 'missing', loc: ['body', 'image'], msg: 'Unsupported image field' },
  ]) {
    const error = await imageHttpError(Response.json({ detail }, { status: 422 }), []);
    assert.match(error.message, /Unsupported image field/);
  }
  for (const detail of [
    null,
    [null, false, 'ignored'],
    Array.from({ length: 9 }, (_, index) => ({
      type: 'missing',
      loc: ['body', { secret: 'nested-secret' }, 'image'],
      msg: index === 8 ? 'ninth-entry' : 'Field required',
    })),
  ]) {
    const error = await imageHttpError(Response.json({ detail }, { status: 422 }), []);
    assert.match(error.message, /HTTP 422/);
    assert.doesNotMatch(error.message, /nested-secret|ninth-entry|ignored/);
    assert.ok(error.message.length <= 2048);
  }
  const oversizedMessage = await imageHttpError(
    Response.json({ detail: 'x'.repeat(10000) }, { status: 422 }),
    []
  );
  assert.ok(oversizedMessage.message.length <= 2048);
});

test('single-image compatibility retries image[] as image only after a missing image validation error', async () => {
  let calls = 0;
  const signal = new AbortController().signal;
  const result = await generateDirectImages(
    { ...model, id: 'gpt-image-2' },
    { input: [{ type: 'text', text: 'Edit' }, image] },
    {
      apiKey: 'fixture-key',
      signal,
      fetch: async (url, init) => {
        calls++;
        assert.equal(url, 'https://example.test/v1/images/edits');
        assert.equal(init.signal, signal);
        assert.equal(init.headers.get('authorization'), 'Bearer fixture-key');
        const form = await parseImageMultipart(url, init);
        assert.equal(form.get('model'), 'gpt-image-2');
        assert.equal(form.get('prompt'), 'Edit');
        const field = calls === 1 ? 'image[]' : 'image';
        assert.equal(form.has(calls === 1 ? 'image' : 'image[]'), false);
        assert.deepEqual(Buffer.from(await form.get(field).arrayBuffer()), png);
        assert.equal(form.get(field).type, 'image/png');
        if (calls === 1)
          return Response.json(
            { detail: [{ type: 'missing', loc: ['body', 'image'], msg: 'Field required' }] },
            { status: 422 }
          );
        return Response.json({ data: [{ b64_json: image.data }] });
      },
    }
  );
  assert.equal(calls, 2);
  assert.equal(result.output[0].data, image.data);
});

test('single-image compatibility handles the gateway string detail and stops after one resend', async () => {
  for (const succeeds of [true, false]) {
    let calls = 0;
    const operation = generateDirectImages(
      { ...model, id: 'gpt-image-2' },
      { input: [{ type: 'text', text: 'Edit' }, image] },
      {
        fetch: async (url, init) => {
          calls++;
          assert.equal(url, 'https://example.test/v1/images/edits');
          const form = await parseImageMultipart(url, init);
          const field = calls === 1 ? 'image[]' : 'image';
          assert.deepEqual([...form.keys()], ['model', 'prompt', field]);
          assert.equal(form.get('model'), 'gpt-image-2');
          assert.equal(form.get('prompt'), 'Edit');
          assert.equal(form.get(field).name, 'reference-0.png');
          assert.equal(form.get(field).type, 'image/png');
          assert.deepEqual(Buffer.from(await form.get(field).arrayBuffer()), png);
          if (calls === 2 && succeeds) {
            return Response.json({ data: [{ b64_json: image.data }] });
          }
          return Response.json({ detail: 'image file is required' }, { status: 422 });
        },
      }
    );
    if (succeeds) {
      assert.equal((await operation).output[0].data, image.data);
    } else {
      await assert.rejects(operation, /HTTP 422.*detail=image file is required/);
    }
    assert.equal(calls, 2);
  }
});

test('compatibility never retries ambiguous validation errors, authentication, rate limits or upstream failures', async () => {
  const missing = { type: 'missing', loc: ['body', 'image'], msg: 'Field required' };
  const cases = [
    ...[400, 401, 403, 429, 500, 502].map((status) => ({ status, body: { detail: [missing] } })),
    ...[400, 401, 403, 429, 500, 502].map((status) => ({
      status,
      body: { detail: 'image file is required' },
    })),
    { status: 422, body: { detail: 'Field required: image' } },
    { status: 422, body: { detail: 'image file is required; upstream generation failed' } },
    { status: 422, body: { detail: 'invalid image file is required' } },
    { status: 422, body: { detail: [{ ...missing, type: 'value_error' }] } },
    { status: 422, body: { detail: [{ ...missing, loc: ['body', 'image', 0] }] } },
    { status: 422, body: { detail: [missing, { ...missing, loc: ['body', 'prompt'] }] } },
    { status: 422, body: { error: { message: 'image[] failed' } } },
  ];
  for (const { status, body } of cases) {
    let calls = 0;
    await assert.rejects(
      generateDirectImages(
        model,
        { input: [{ type: 'text', text: 'Edit' }, image] },
        {
          fetch: async () => {
            calls++;
            return Response.json(body, { status });
          },
        }
      ),
      new RegExp(`HTTP ${status}`)
    );
    assert.equal(calls, 1);
  }
});

test('compatibility preserves multi-image requests and never retries Qwen or text generation', async () => {
  for (const [selectedModel, references] of [
    [model, [image, image]],
    [model, []],
    [{ ...model, id: 'qwen-image-edit', api: 'qwen-images', provider: 'qwen' }, [image]],
  ]) {
    let calls = 0;
    await assert.rejects(
      generateDirectImages(
        selectedModel,
        { input: [{ type: 'text', text: 'Edit' }, ...references] },
        {
          fetch: async () => {
            calls++;
            return Response.json(
              { detail: [{ type: 'missing', loc: ['body', 'image'], msg: 'Field required' }] },
              { status: 422 }
            );
          },
        }
      ),
      /HTTP 422/
    );
    assert.equal(calls, 1);
  }
});

test('cancellation and network errors never trigger a compatibility resend', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    generateDirectImages(
      model,
      { input: [image] },
      {
        signal: controller.signal,
        fetch: async () => {
          calls++;
          controller.abort();
          return Response.json(
            { detail: [{ type: 'missing', loc: ['body', 'image'], msg: 'Field required' }] },
            { status: 422 }
          );
        },
      }
    ),
    { name: 'AbortError' }
  );
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(
    generateDirectImages(
      model,
      { input: [image] },
      {
        fetch: async () => {
          calls++;
          throw new Error('Network failed');
        },
      }
    ),
    /Network failed/
  );
  assert.equal(calls, 1);
});

test('image skill registers a bundled resource and injects only fresh redacted provider context when active', async (t) => {
  const cwd = await fixture(t);
  const handlers = new Map();
  let activeTools = ['image_generate'];
  createImagegenExtension(cwd)({
    registerTool() {},
    on: (name, handler) => handlers.set(name, handler),
    getActiveTools: () => activeTools,
  });
  const discover = handlers.get('resources_discover');
  for (const reason of ['startup', 'reload']) {
    const discovered = discover({ cwd, reason });
    assert.deepEqual(discovered.skillPaths, [
      fileURLToPath(new URL('../dist/extensions/imagegen/skills/imagegen/', import.meta.url)),
    ]);
  }
  const skillPath = new URL('../dist/extensions/imagegen/skills/imagegen/SKILL.md', import.meta.url);
  const bundled = (await readFile(skillPath, 'utf8')).replace(/^---[\s\S]*?---\s*/u, '');
  const event = { systemPrompt: 'Existing system guidance' };
  const beforeStart = handlers.get('before_agent_start');
  const first = await beforeStart(event);
  assert.ok(first.systemPrompt.startsWith(event.systemPrompt));
  assert.equal(first.systemPrompt.includes(bundled), false);
  const contextOf = (result) =>
    JSON.parse(result.systemPrompt.match(/<image_service_context>(.*?)<\/image_service_context>/s)[1]);
  assert.deepEqual(contextOf(first), { enabled: false, provider: 'openai', model: 'gpt-image-1.5' });
  await configureImages(cwd, 'qwen');
  const second = await beforeStart(event);
  assert.deepEqual(contextOf(second), { enabled: true, provider: 'qwen', model: 'qwen-image-3.0-pro' });
  assert.equal(second.systemPrompt.includes('fixture-key'), false);
  assert.equal(second.systemPrompt.includes(bundled), false);
  assert.equal(
    second.systemPrompt.includes('name: imagegen'),
    false,
    'frontmatter is discovery metadata, not runtime guidance'
  );
  activeTools = [];
  assert.equal(await beforeStart(event), undefined);
  activeTools = ['image_generate'];
  await writeFile(join(cwd, 'imagegen.json'), '{broken');
  const unavailable = await beforeStart(event);
  assert.equal(unavailable.systemPrompt.includes(bundled), false);
  assert.equal(unavailable.systemPrompt.includes('{broken'), false);
});

for (const mode of ['tui', 'rpc']) {
  test(`the built image skill is discovered and read on demand in a real Pi ${mode} session and survives reload`, async (t) => {
    const cwd = await fixture(t);
    const requests = [];
    const skillPath = fileURLToPath(
      new URL('../dist/extensions/imagegen/skills/imagegen/SKILL.md', import.meta.url)
    );
    const http = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
      }
      requests.push(JSON.parse(raw));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const frame = { id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'base' };
      if (requests.length === 3) {
        res.write(
          'data: ' +
            JSON.stringify({
              ...frame,
              choices: [
                {
                  index: 0,
                  delta: {
                    role: 'assistant',
                    tool_calls: [
                      {
                        index: 0,
                        id: 'read-image-skill',
                        type: 'function',
                        function: { name: 'read', arguments: JSON.stringify({ path: skillPath }) },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            }) +
            '\n\n'
        );
        res.write(
          'data: ' +
            JSON.stringify({
              ...frame,
              choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
            }) +
            '\n\n'
        );
        res.end('data: [DONE]\n\n');
        return;
      }
      res.write(
        'data: ' +
          JSON.stringify({
            ...frame,
            choices: [
              { index: 0, delta: { role: 'assistant', content: 'Fixture answer' }, finish_reason: null },
            ],
          }) +
          '\n\n'
      );
      res.write(
        'data: ' +
          JSON.stringify({
            ...frame,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          }) +
          '\n\n'
      );
      res.end('data: [DONE]\n\n');
    });
    await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => http.close(resolve)));
    await writeFile(
      join(cwd, 'models.json'),
      JSON.stringify({
        providers: {
          fixture: {
            api: 'openai-completions',
            apiKey: 'fixture-only',
            baseUrl: `http://127.0.0.1:${http.address().port}/v1`,
            models: [
              {
                id: 'base',
                name: 'base',
                reasoning: false,
                input: ['text'],
                contextWindow: 32000,
                maxTokens: 256,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              },
            ],
          },
        },
      })
    );
    const modelRuntime = await ModelRuntime.create({
      modelsPath: join(cwd, 'models.json'),
      authPath: join(cwd, 'auth.json'),
      modelsStorePath: join(cwd, 'models-store.json'),
    });
    const settingsManager = SettingsManager.inMemory({
      autoCompactionEnabled: false,
      autoRetryEnabled: false,
    });
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir: cwd,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [{ name: 'octopus-imagegen', factory: createImagegenExtension(cwd) }],
    });
    await loader.reload();
    const { session } = await createAgentSession({
      cwd,
      agentDir: cwd,
      settingsManager,
      modelRuntime,
      model: modelRuntime.getModel('fixture', 'base'),
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(cwd),
      tools: ['read', 'image_generate'],
    });
    t.after(() => session.dispose());
    const errors = [];
    await session.bindExtensions({ mode, onError: (error) => errors.push(error) });
    assert.deepEqual(loader.getSkills().diagnostics, []);
    assert.equal(loader.getSkills().skills.filter((entry) => entry.name === 'imagegen').length, 1);
    assert.equal(loader.getSkills().skills.find((entry) => entry.name === 'imagegen').filePath, skillPath);
    assert.ok(session.getActiveToolNames().includes('image_generate'));
    const bundled = (
      await readFile(new URL('../dist/extensions/imagegen/skills/imagegen/SKILL.md', import.meta.url), 'utf8')
    ).replace(/^---[\s\S]*?---\s*/u, '');
    await session.prompt('Explain how image editing works without invoking image_generate.');
    assert.equal(requests.length, 1);
    const firstPrompt = requests[0].messages.find((message) => message.role === 'system').content;
    assert.ok(firstPrompt.includes('<available_skills>'));
    assert.ok(firstPrompt.includes('<name>imagegen</name>'));
    assert.ok(firstPrompt.includes(skillPath));
    assert.equal(firstPrompt.includes(bundled), false, 'the catalogue excludes the skill body');
    await configureImages(cwd, 'qwen');
    await session.reload();
    await session.prompt('Explain the current image provider without invoking image_generate.');
    assert.equal(requests.length, 2);
    const secondPrompt = requests[1].messages.find((message) => message.role === 'system').content;
    assert.equal(secondPrompt.includes(bundled), false);
    assert.equal(secondPrompt.split('<name>imagegen</name>').length - 1, 1);
    assert.ok(secondPrompt.includes('"provider":"qwen"'));
    assert.equal(secondPrompt.includes('fixture-key'), false);
    assert.deepEqual(loader.getSkills().diagnostics, []);
    assert.equal(loader.getSkills().skills.filter((entry) => entry.name === 'imagegen').length, 1);
    assert.equal(loader.getSkills().skills.find((entry) => entry.name === 'imagegen').filePath, skillPath);
    await session.prompt('Read the imagegen skill before explaining image editing.');
    assert.equal(requests.length, 4);
    const skillResult = requests[3].messages.find((message) => message.role === 'tool');
    assert.ok(
      skillResult.content.includes(bundled),
      'the public read tool loads the complete skill on demand'
    );
    assert.deepEqual(errors, []);
  });
}
