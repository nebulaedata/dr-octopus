/**
 * @author Codex
 * @description Verifies ASR persistence, secret redaction, protocol forwarding, admission and cancellation.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify from 'fastify';
import autoload from '@fastify/autoload';
import { fileURLToPath } from 'node:url';
import { SpeechRepository } from '../dist/modules/speech/speech.repository.js';
import { SpeechService } from '../dist/modules/speech/speech.service.js';
import { registerSpeechController, speechErrorMessages } from '../dist/modules/speech/speech.controller.js';

/**
 * Creates isolated persisted settings without reading or writing user configuration.
 */
async function fixture(t, fetcher) {
  const root = await mkdtemp(join(tmpdir(), 'octopus-speech-'));
  const repository = new SpeechRepository(root);
  const service = new SpeechService(repository, fetcher);
  const app = Fastify();
  registerSpeechController(app, service);
  t.after(async () => {
    await app.close();
    await service.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, repository, service, app };
}

/**
 * Supplies the current revision and editable settings without DTO-only fields.
 */
async function input(service, patch = {}) {
  const settings = await service.get();
  const { enabled, activeProvider, ...configuration } = patch;
  const id = activeProvider ?? settings.activeProvider;
  const { baseUrl, model } = settings.providers[id];
  const provider = { baseUrl, model };
  return {
    revision: settings.revision,
    ...(enabled === undefined ? {} : { enabled }),
    ...(activeProvider ? { activeProvider } : {}),
    provider: { id, ...provider, ...configuration },
  };
}

test('speech defaults off; saves are atomic, redacted, revision checked and retain omitted keys', async (t) => {
  const { service, repository, root, app } = await fixture(t);
  const initial = await app.inject('/settings/speech');
  assert.equal(initial.json().enabled, false);
  assert.equal(initial.headers['cache-control'], 'no-store');
  assert.deepEqual(await readdir(root), []);
  const change = await input(service, { enabled: true, apiKey: 'private-key' });
  const results = await Promise.all([service.update(change), service.update(change).catch((e) => e)]);
  assert.equal(results[1].code, 'SPEECH_CONFLICT');
  assert.equal(results[0].providers.openai.hasApiKey, true);
  assert.ok(!JSON.stringify(results[0]).includes('private-key'));
  await service.update(await input(service, { model: 'custom-asr' }));
  assert.equal((await repository.read()).config.providers.openai.apiKey, 'private-key');
  assert.equal(
    (await new SpeechService(new SpeechRepository(root)).get()).providers.openai.model,
    'custom-asr'
  );
  await service.update(await input(service, { enabled: false, apiKey: null }));
  assert.equal((await service.get()).providers.openai.hasApiKey, false);
  for (const baseUrl of [
    'not a url',
    'file:///tmp/asr',
    'https://user:secret@example.com/v1',
    'https://asr.test/v1?key=secret',
  ]) {
    const response = await app.inject({
      method: 'PUT',
      url: '/settings/speech',
      payload: await input(service, { baseUrl }),
    });
    assert.equal(response.statusCode, 400);
  }
});

test('binary audio forwards as OpenAI multipart and never returns provider diagnostics', async (t) => {
  let calls = 0;
  let fail = false;
  const { service, app } = await fixture(t, async (url, options) => {
    calls++;
    assert.equal(url, 'https://asr.example/v1/audio/transcriptions');
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    assert.equal(options.body.get('model'), 'test-asr');
    assert.equal(options.body.get('response_format'), 'json');
    const file = options.body.get('file');
    assert.equal(file.name, 'recording.webm');
    assert.equal(await file.text(), 'test-audio');
    return fail
      ? new Response('provider leaked test-secret', { status: 401 })
      : Response.json({ text: '  你好，语音输入。  ' });
  });
  const audioRequest = {
    method: 'POST',
    url: '/speech/transcriptions',
    headers: { 'content-type': 'audio/webm;codecs=opus' },
    payload: Buffer.from('test-audio'),
  };
  assert.equal((await app.inject(audioRequest)).statusCode, 409);
  assert.equal(calls, 0);
  await service.update(
    await input(service, {
      enabled: true,
      baseUrl: 'https://asr.example/v1/',
      model: 'test-asr',
      apiKey: 'test-secret',
    })
  );
  const success = await app.inject(audioRequest);
  assert.equal(success.statusCode, 200);
  assert.deepEqual(success.json(), { text: '你好，语音输入。' });
  fail = true;
  const failed = await app.inject(audioRequest);
  assert.equal(failed.statusCode, 502);
  assert.ok(!failed.body.includes('test-secret'));
  assert.equal((await app.inject({ ...audioRequest, payload: Buffer.alloc(0) })).statusCode, 400);
  assert.equal(
    (await app.inject({ ...audioRequest, payload: Buffer.alloc(10 * 1024 * 1024 + 1) })).statusCode,
    413
  );
});

test('malformed provider results fail explicitly; empty recognition stays empty', async (t) => {
  let result = { unexpected: true };
  const { service } = await fixture(t, async () => Response.json(result));
  await service.update(await input(service, { enabled: true }));
  await assert.rejects(service.transcribe(Buffer.from('audio'), 'audio/mp4', new AbortController().signal), {
    code: 'SPEECH_RESPONSE_INVALID',
  });
  result = { text: '' };
  assert.deepEqual(
    await service.transcribe(Buffer.from('audio'), 'audio/mp4', new AbortController().signal),
    { text: '' }
  );
});

test('disabling or closing cancels in-flight ASR; concurrency is bounded', async (t) => {
  let started = 0;
  const { service } = await fixture(
    t,
    (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        started++;
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      })
  );
  await service.update(await input(service, { enabled: true }));
  const jobs = Array.from({ length: 4 }, () =>
    service.transcribe(Buffer.from('audio'), 'audio/webm', new AbortController().signal).catch((e) => e.code)
  );
  while (started < 4) await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(service.transcribe(Buffer.from('audio'), 'audio/webm', new AbortController().signal), {
    code: 'SPEECH_BUSY',
  });
  await service.update(await input(service, { enabled: false }));
  assert.deepEqual(await Promise.all(jobs), Array(4).fill('SPEECH_CANCELLED'));
  await service.update(await input(service, { enabled: true }));
  const last = service
    .transcribe(Buffer.from('audio'), 'audio/webm', new AbortController().signal)
    .catch((e) => e.code);
  while (started < 5) await new Promise((resolve) => setImmediate(resolve));
  await service.close();
  assert.equal(await last, 'SPEECH_CANCELLED');
});

test('speech module autoload owns scoped API routes and bilingual error catalog', async (t) => {
  const { root } = await fixture(t);
  const app = Fastify();
  t.after(() => app.close());
  await app.register(autoload, {
    dir: fileURLToPath(new URL('../dist/modules/speech/', import.meta.url)),
    options: { storagePaths: { stateRoot: root } },
  });
  assert.equal((await app.inject('/api/settings/speech')).statusCode, 200);
  assert.equal((await app.inject('/settings/speech')).statusCode, 404);
  for (const entry of Object.values(speechErrorMessages)) {
    assert.ok(entry.en);
    assert.ok(entry['zh-CN']);
  }
});

test('providers keep independent credentials; selecting Qwen requires its own key and survives restart', async (t) => {
  const { service, repository, root } = await fixture(t);
  await service.update(await input(service, { enabled: true, apiKey: 'openai-secret' }));
  const previous = await service.get();
  await assert.rejects(service.update({ revision: previous.revision, activeProvider: 'qwen' }), {
    code: 'SPEECH_KEY_REQUIRED',
  });
  assert.deepEqual(await service.get(), previous);
  await assert.rejects(
    service.update({
      revision: previous.revision,
      provider: { id: 'qwen', ...previous.providers.qwen, apiKey: 'qwen-secret' },
    }),
    { code: 'SPEECH_INVALID' }
  );
  // DTO-only fields are rejected, so construct the explicit editable provider contract.
  const { baseUrl, model } = previous.providers.qwen;
  await service.update({
    revision: previous.revision,
    provider: { id: 'qwen', baseUrl, model, apiKey: 'qwen-secret' },
  });
  assert.equal((await service.get()).activeProvider, 'openai');
  await service.update({ revision: (await service.get()).revision, activeProvider: 'qwen' });
  const restored = await new SpeechService(new SpeechRepository(root)).get();
  assert.equal(restored.activeProvider, 'qwen');
  assert.equal(restored.providers.openai.hasApiKey, true);
  assert.equal(restored.providers.qwen.hasApiKey, true);
  assert.ok(!JSON.stringify(restored).includes('-secret'));
  await assert.rejects(service.update(await input(service, { apiKey: null })), {
    code: 'SPEECH_KEY_REQUIRED',
  });
  await service.update(await input(service, { enabled: false, apiKey: null }));
  const { config } = await repository.read();
  assert.equal(config.providers.qwen.apiKey, '');
  assert.equal(config.providers.openai.apiKey, 'openai-secret');
});

test('Qwen 3.1 forwards inline audio through DashScope and reads full output text', async (t) => {
  const requests = [];
  const { service } = await fixture(t, async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    assert.equal(
      url,
      'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
    );
    assert.equal(options.headers.Authorization, 'Bearer qwen-private');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.equal(options.headers['X-DashScope-SSE'], 'disable');
    assert.equal(options.redirect, 'error');
    assert.equal(body.model, 'qwen-audio-3.1-asr-flash');
    assert.equal(body.input.messages[0].role, 'user');
    const content = body.input.messages[0].content[0];
    assert.equal(content.type, 'input_audio');
    assert.equal(Buffer.from(content.input_audio.data.split(',')[1], 'base64').toString(), 'test-audio');
    return Response.json({ output: { sentence: { text: 'last sentence' }, text: ' 完整识别结果。 ' } });
  });
  await service.update(
    await input(service, {
      enabled: true,
      activeProvider: 'qwen',
      apiKey: 'qwen-private',
      baseUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/',
    })
  );
  for (const [mime, format] of [
    ['audio/webm;codecs=opus', 'webm'],
    ['audio/mp4', 'mp4'],
    ['audio/ogg;codecs=opus', 'ogg'],
  ]) {
    assert.deepEqual(
      await service.transcribe(Buffer.from('test-audio'), mime, new AbortController().signal),
      { text: '完整识别结果。' }
    );
    assert.equal(requests.at(-1).parameters.format, format);
    assert.match(
      requests.at(-1).input.messages[0].content[0].input_audio.data,
      new RegExp(`^data:${mime.split(';')[0]};base64,`)
    );
  }
  await assert.rejects(
    service.transcribe(Buffer.alloc(8 * 1024 * 1024), 'audio/webm', new AbortController().signal),
    { code: 'SPEECH_AUDIO_TOO_LARGE' }
  );
  assert.equal(requests.length, 3);
});

test('Qwen errors are redacted, malformed output fails and switching back uses the OpenAI protocol', async (t) => {
  let result = { output: { text: 123 } };
  let fail = false;
  let lastBody;
  const { service } = await fixture(t, async (_url, { body }) => {
    lastBody = body;
    return fail ? new Response('qwen-secret private diagnostic', { status: 401 }) : Response.json(result);
  });
  await service.update(
    await input(service, { activeProvider: 'qwen', enabled: true, apiKey: 'qwen-secret' })
  );
  const transcribe = () =>
    service.transcribe(Buffer.from('audio'), 'audio/mp4', new AbortController().signal);
  await assert.rejects(transcribe(), { code: 'SPEECH_RESPONSE_INVALID' });
  fail = true;
  await assert.rejects(transcribe(), { code: 'SPEECH_REQUEST_FAILED', message: 'SPEECH_REQUEST_FAILED' });
  fail = false;
  result = { output: { text: '' } };
  assert.deepEqual(await transcribe(), { text: '' });
  await service.update({ revision: (await service.get()).revision, activeProvider: 'openai' });
  result = { text: 'back to OpenAI' };
  assert.deepEqual(await transcribe(), { text: 'back to OpenAI' });
  assert.ok(lastBody instanceof FormData);
  assert.equal(lastBody.get('model'), 'whisper-1');
});
