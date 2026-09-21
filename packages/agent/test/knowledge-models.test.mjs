/**
 * @author Codex
 * @description Model contract regressions for unauthenticated private services, malformed outputs and abort.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { KnowledgeEmbeddings } from '../dist/extensions/knowledge/lib/models/embedding.js';
import { rerankCandidates } from '../dist/extensions/knowledge/lib/models/reranker.js';
import { recognizePage } from '../dist/extensions/knowledge/lib/models/ocr.js';
import { modelRequest, modelEndpoint } from '../dist/extensions/knowledge/lib/models/request.js';

const connection = { endpoint: 'http://127.0.0.1:1234/v1/', model: 'fixture', timeoutMs: 1000 };
const embedding = { ...connection, kind: 'embedding', dimensions: 2, batchSize: 2 };

test('embedding omits Authorization for empty keys and restores provider ordering', async () => {
  const adapter = new KnowledgeEmbeddings(embedding, undefined, async (url, options) => {
    assert.equal(url.pathname, '/v1/embeddings');
    assert.equal(options.headers.authorization, undefined);
    assert.equal(options.redirect, 'error');
    return Response.json({
      data: [
        { index: 1, embedding: [0, 1] },
        { index: 0, embedding: [1, 0] },
      ],
    });
  });
  assert.deepEqual(await adapter.embedDocuments(['first', 'second']), [
    [1, 0],
    [0, 1],
  ]);
});

test('embedding rejects dimensions, duplicate indices and nonfinite vectors', async () => {
  for (const data of [
    [{ index: 0, embedding: [1] }],
    [{ index: 1, embedding: [1, 2] }],
    [{ index: 0, embedding: [null, 2] }],
    [{ index: 0, embedding: [0, 0] }],
  ]) {
    const adapter = new KnowledgeEmbeddings(embedding, undefined, async () => Response.json({ data }));
    await assert.rejects(() => adapter.embedQuery('question'));
  }
});

test('reranker cannot forge or duplicate candidate identities', async () => {
  const config = {
    ...connection,
    kind: 'reranker',
    enabled: true,
    maxCandidates: 40,
    allowRemoteEvidence: false,
  };
  await assert.rejects(
    () =>
      rerankCandidates(config, 'query', ['a', 'b'], undefined, async () =>
        Response.json({
          results: [
            { index: 0, relevance_score: 1 },
            { index: 0, relevance_score: 0.2 },
          ],
        })
      ),
    { code: 'MODEL_RESPONSE_INVALID' }
  );
});

test('OCR rejects truncated completions instead of indexing a partial page', async () => {
  const config = { ...connection, kind: 'ocr', mode: 'auto', maxOutputTokens: 512 };
  await assert.rejects(
    () =>
      recognizePage(config, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), undefined, async () =>
        Response.json({ choices: [{ finish_reason: 'length', message: { content: 'truncated' } }] })
      ),
    { code: 'OCR_INCOMPLETE' }
  );
});

test('model request cancellation and failures never reveal provider secrets', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => modelRequest(connection, 'embeddings', {}, controller.signal), {
    code: 'CANCELLED',
  });
  await assert.rejects(
    () =>
      modelRequest(
        connection,
        'embeddings',
        {},
        undefined,
        async () => new Response('credential secret', { status: 503 })
      ),
    (error) => {
      assert.equal(error.code, 'MODEL_REQUEST_FAILED');
      assert.equal(error.retryable, true);
      assert.ok(!error.message.includes('credential'));
      return true;
    }
  );
});

test('model endpoint accepts explicit private addresses but rejects credentials and redirects in config', () => {
  assert.equal(modelEndpoint('http://192.168.77.201:8031/v1', 'embeddings').pathname, '/v1/embeddings');
  for (const value of [
    'file:///test',
    'http://u:p@localhost/v1',
    'http://169.254.169.254/v1',
    'http://localhost/?secret=x',
  ]) {
    assert.throws(() => modelEndpoint(value, 'embeddings'), { code: 'MODEL_CONFIG_INVALID' });
  }
});
