/**
 * @author Codex
 * @description Verifies standalone Agent inference, private admission, bounded file input and cancellation.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createKnowledgeApplication } from '../dist/extensions/knowledge/daemon/application.js';
import { parseKnowledgeCommand } from '../dist/extensions/knowledge/daemon/protocol.js';
import { registerKnowledgeModelTools } from '../dist/extensions/knowledge/extension/model-tools.js';
import { readOcrInput } from '../dist/extensions/knowledge/lib/ocr-input.js';
import { modelToolNames } from '../dist/extensions/knowledge/definitions/model-tool-schemas.js';

const context = {
  principal: 'agent:test',
  workspaceId: 'test',
  globalWrite: true,
  modelAccess: 'manage',
};
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=',
  'base64'
);

test('registered tools execute without collections using saved model settings and private admission', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-model-tools-'));
  const requests = [];
  const http = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push({ path: req.url, body, authorization: req.headers.authorization });
    res.setHeader('content-type', 'application/json');
    if (req.url.endsWith('/embeddings')) {
      res.end(
        JSON.stringify({
          data: body.input.map((_, index) => ({ index, embedding: [index + 1, 2] })).reverse(),
        })
      );
    } else if (req.url.endsWith('/rerank')) {
      res.end(
        JSON.stringify({
          results: [
            { index: 1, relevance_score: 0.9 },
            { index: 0, relevance_score: 0.1 },
          ],
        })
      );
    } else {
      res.end(
        JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'recognized page' } }] })
      );
    }
  });
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
  let app;
  t.after(async () => {
    await app?.close();
    await new Promise((resolve) => http.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  app = await createKnowledgeApplication(directory, join(directory, 'agent'));
  const client = {
    call: (operation, input, signal) =>
      app.call(parseKnowledgeCommand({ operation, input, context }), signal),
    upload: (bytes) => app.upload(bytes),
  };
  const tools = new Map();
  registerKnowledgeModelTools({ registerTool: (tool) => tools.set(tool.name, tool) }, client);
  assert.deepEqual([...tools.keys()], ['ocr_image', 'embed_text', 'rerank_documents']);
  assert.deepEqual([...tools.keys()], modelToolNames);
  const execute = (name, input, signal) =>
    tools.get(name).execute('test', input, signal, undefined, { cwd: directory });
  await assert.rejects(execute('embed_text', { texts: ['one'] }), { code: 'MODEL_NOT_CONFIGURED' });
  const connection = {
    endpoint: `http://127.0.0.1:${http.address().port}/v1`,
    model: 'fixture',
    timeoutMs: 1000,
    apiKey: 'private-key',
  };
  await client.call('settings.save', {
    revision: 0,
    config: { ...connection, kind: 'embedding', dimensions: 2, batchSize: 4 },
  });
  await client.call('settings.save', {
    revision: 1,
    config: { ...connection, kind: 'ocr', mode: 'auto', maxOutputTokens: 512 },
  });
  await client.call('settings.save', {
    revision: 2,
    config: { ...connection, kind: 'reranker', enabled: true, maxCandidates: 2, allowRemoteEvidence: false },
  });
  await writeFile(join(directory, 'page.png'), png);
  const embedded = await execute('embed_text', { texts: ['one', 'two'] });
  assert.deepEqual(embedded.details, {
    vectors: [
      [1, 2],
      [2, 2],
    ],
    dimensions: 2,
  });
  assert.deepEqual(JSON.parse(embedded.content[0].text), embedded.details);
  assert.equal((await execute('ocr_image', { path: 'page.png' })).details.text, 'recognized page');
  assert.deepEqual((await execute('rerank_documents', { query: 'q', documents: ['a', 'b'] })).details, {
    results: [
      { index: 1, score: 0.9 },
      { index: 0, score: 0.1 },
    ],
  });
  assert.equal(requests.length, 3);
  const delegatedContext = { ...context, globalWrite: false, modelAccess: 'invoke' };
  const delegatedClient = {
    call: (operation, input, signal) =>
      app.call(parseKnowledgeCommand({ operation, input, context: delegatedContext }), signal),
    upload: (bytes) => app.upload(bytes),
  };
  const delegatedTools = new Map();
  registerKnowledgeModelTools(
    { registerTool: (tool) => delegatedTools.set(tool.name, tool) },
    delegatedClient
  );
  assert.deepEqual(
    (
      await delegatedTools
        .get('embed_text')
        .execute('delegated-embed', { texts: ['delegated'] }, undefined, undefined, { cwd: directory })
    ).details,
    { vectors: [[1, 2]], dimensions: 2 }
  );
  assert.equal(
    (
      await delegatedTools
        .get('ocr_image')
        .execute('delegated-ocr', { path: 'page.png' }, undefined, undefined, { cwd: directory })
    ).details.text,
    'recognized page'
  );
  assert.deepEqual(
    (
      await delegatedTools
        .get('rerank_documents')
        .execute('delegated-rerank', { query: 'q', documents: ['one', 'two'] }, undefined, undefined, {
          cwd: directory,
        })
    ).details,
    {
      results: [
        { index: 1, score: 0.9 },
        { index: 0, score: 0.1 },
      ],
    }
  );
  await assert.rejects(app.call({ operation: 'settings.get', input: {}, context: delegatedContext }), {
    code: 'MODEL_MANAGEMENT_DENIED',
  });
  await assert.rejects(
    app.call({
      operation: 'collections.create',
      input: { scope: { kind: 'global' }, name: 'Forbidden delegated write', description: '' },
      context: delegatedContext,
    }),
    { code: 'FORBIDDEN' }
  );
  assert.equal(requests.length, 6, 'delegated invocation uses providers without granting management');
  const jpeg = Buffer.from('ffd8ffe000104a4649460001', 'hex');
  await writeFile(join(directory, 'photo.jpg'), jpeg);
  assert.equal((await execute('ocr_image', { path: 'photo.jpg' })).details.text, 'recognized page');
  assert.equal(
    requests.at(-1).body.messages[0].content[0].image_url.url,
    `data:image/jpeg;base64,${jpeg.toString('base64')}`
  );
  assert.ok(requests.every((request) => request.authorization === 'Bearer private-key'));
  assert.equal((await client.call('collections.list', {})).total, 0);
  assert.equal(app.database.sqlite.prepare('SELECT count(*) AS n FROM knowledge_jobs').get().n, 0);
  for (const caller of [
    { ...context, modelAccess: 'none' },
    { ...context, principal: 'mcp:remote', modelAccess: 'none' },
  ]) {
    await assert.rejects(app.call({ operation: 'models.embed', input: { texts: ['a'] }, context: caller }), {
      code: 'MODEL_ACCESS_DENIED',
    });
  }
  await assert.rejects(execute('embed_text', { texts: ['x'.repeat(24000), 'x'.repeat(24000), 'x'] }), {
    code: 'INVALID_INPUT',
  });
  await assert.rejects(execute('rerank_documents', { query: 'q', documents: ['a', 'b', 'c'] }), {
    code: 'INVALID_INPUT',
  });
  assert.throws(
    () =>
      parseKnowledgeCommand({
        operation: 'models.embed',
        input: { texts: ['a'], endpoint: 'http://attacker' },
        context,
      }),
    { code: 'INVALID_INPUT' }
  );
  assert.throws(
    () => parseKnowledgeCommand({ operation: 'models.embed', input: { texts: Array(5).fill('a') }, context }),
    { code: 'INVALID_INPUT' }
  );
  assert.throws(
    () =>
      parseKnowledgeCommand({
        operation: 'models.embed',
        input: { texts: ['a'] },
        context: { principal: 'agent:missing-access', globalWrite: true },
      }),
    { code: 'INVALID_INPUT' }
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(execute('embed_text', { texts: ['a'] }, controller.signal), {
    name: 'AbortError',
  });
  await client.call('settings.save', {
    revision: 3,
    config: { ...connection, kind: 'ocr', mode: 'off', maxOutputTokens: 512 },
  });
  await assert.rejects(execute('ocr_image', { path: 'page.png' }), { code: 'OCR_NOT_CONFIGURED' });
  await client.call('settings.save', {
    revision: 4,
    config: { ...connection, kind: 'reranker', enabled: false, maxCandidates: 2, allowRemoteEvidence: false },
  });
  await assert.rejects(execute('rerank_documents', { query: 'q', documents: ['a', 'b'] }), {
    code: 'MODEL_NOT_CONFIGURED',
  });
  assert.equal(requests.length, 7, 'rejected operations must not invoke providers');
});

test('OCR reads external absolute and relative local paths while rejecting non-images and cancellation', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-ocr-input-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const workspace = join(directory, 'workspace');
  const outside = join(directory, 'outside');
  await mkdir(workspace);
  await mkdir(outside);
  await writeFile(join(outside, 'page.png'), png);
  await writeFile(join(workspace, 'fake.png'), 'not a png file');
  await symlink(outside, join(workspace, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.deepEqual(await readOcrInput(workspace, '../outside/page.png'), png);
  assert.deepEqual(await readOcrInput(workspace, 'linked/page.png'), png);
  await assert.rejects(readOcrInput(workspace, 'fake.png'), { code: 'INVALID_INPUT' });
  assert.deepEqual(await readOcrInput(workspace, join(outside, 'page.png')), png);
  assert.deepEqual(await readOcrInput(join(directory, 'missing-workspace'), join(outside, 'page.png')), png);
  await assert.rejects(readOcrInput(workspace, join(outside, 'missing.png')), { code: 'ENOENT' });
  await assert.rejects(readOcrInput(workspace, outside), { code: 'INVALID_INPUT' });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(readOcrInput(workspace, 'fake.png', controller.signal), { name: 'AbortError' });
});

test('standalone model tools remain absent from the public knowledge MCP registrations', async () => {
  const source = await readFile(
    new URL('../../../apps/server/src/modules/knowledge/knowledge-mcp.controller.ts', import.meta.url),
    'utf8'
  );
  assert.deepEqual(
    [...source.matchAll(/server\.registerTool\(\s*'([^']+)'/gu)].map((match) => match[1]),
    ['knowledge_describe', 'knowledge_list_collections', 'knowledge_search', 'knowledge_read']
  );
});
