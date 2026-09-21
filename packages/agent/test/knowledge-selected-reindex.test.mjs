/**
 * @author Codex
 * @description Verifies durable document selection and preserves unrelated searchable entries during partial rebuilds.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { openKnowledgeDatabase } from '../dist/extensions/knowledge/db/database.js';
import { SqliteCatalogRepository } from '../dist/extensions/knowledge/lib/catalog-repository.js';
import { KnowledgeCatalogService } from '../dist/extensions/knowledge/services/catalog-service.js';
import { KnowledgeJobRepository } from '../dist/extensions/knowledge/lib/job-repository.js';
import { KnowledgeIndexingRunner } from '../dist/extensions/knowledge/lib/indexing-runner.js';
import { KnowledgeBlobStore } from '../dist/extensions/knowledge/lib/blob-store.js';
import { entries, generations } from '../dist/extensions/knowledge/db/schema.js';

/**
 * Publishes two independent document entries without contacting a model provider.
 */
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-selected-reindex-'));
  const database = openKnowledgeDatabase(join(directory, 'control.sqlite'));
  t.after(async () => {
    database.sqlite.close();
    await rm(directory, { recursive: true, force: true });
  });
  const catalog = new SqliteCatalogRepository(database);
  const service = new KnowledgeCatalogService(catalog);
  const context = { principal: 'test', globalWrite: true, modelAccess: 'none' };
  const collection = service.create(context, { kind: 'global' }, 'selected');
  const other = service.create(context, { kind: 'global' }, 'other');
  const repository = new KnowledgeJobRepository(database);
  const config = {
    kind: 'embedding',
    endpoint: 'http://127.0.0.1/v1',
    model: 'test',
    timeoutMs: 30000,
    dimensions: 2,
    batchSize: 8,
  };
  const ids = [];
  for (const title of ['first', 'second']) {
    const blob = await new KnowledgeBlobStore(directory).put(
      Buffer.from(`${title} selected document content`)
    );
    const source = { title, format: 'txt', blobSha256: blob.sha256 };
    repository.enqueue('test', collection.id, title, 'import', source, config, null);
    const job = repository.claim();
    const generation = repository.generation(job);
    const leaf = repository.leaf(job, title, title);
    const document = repository.prepareDocument(job, leaf, source);
    repository.publish(job, leaf.id, generation.id, document.documentId, document.versionId, title, 1);
    repository.finish(job, 'succeeded');
    ids.push(document.documentId);
  }
  return { directory, database, repository, config, collection, other, ids, catalog };
}

test('selection admission rejects invalid targets and fences replay payloads while retaining full rebuild compatibility', async (t) => {
  const { repository, config, collection, other, ids } = await fixture(t);
  const enqueue = (key, selection, collectionId = collection.id) =>
    repository.enqueue('test', collectionId, key, 'reindex', null, config, null, selection);
  assert.throws(() => enqueue('empty', []), { code: 'INVALID_INPUT' });
  assert.throws(() => enqueue('duplicate', [ids[0], ids[0]]), { code: 'INVALID_INPUT' });
  assert.throws(() => enqueue('missing', ['missing']), { code: 'NOT_FOUND' });
  assert.throws(() => enqueue('foreign', ids, other.id), { code: 'NOT_FOUND' });
  const selected = enqueue('selected', ids);
  assert.deepEqual(repository.get(selected.id).documentIds, ids);
  assert.equal(
    repository.replay('test', collection.id, 'selected', 'reindex', null, [...ids].reverse()).id,
    selected.id
  );
  assert.throws(() => repository.replay('test', collection.id, 'selected', 'reindex', null, [ids[0]]), {
    code: 'IDEMPOTENCY_CONFLICT',
  });
  assert.throws(() => enqueue('busy', [ids[0]]), { code: 'REINDEX_BUSY' });
  repository.cancel(selected.id);
  const full = enqueue('full');
  assert.equal(full.documentIds, null);
  assert.equal(repository.replay('test', collection.id, 'full', 'reindex', null).id, full.id);
});

test('runner indexes only selected documents in the existing generation and preserves unrelated entries', async (t) => {
  const { repository, config, collection, ids, catalog, database, directory } = await fixture(t);
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push(body);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ data: body.input.map((_, index) => ({ index, embedding: [1, 0] })) }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      })
  );
  const writes = [];
  const runner = new KnowledgeIndexingRunner(
    repository,
    {
      write: async (generation, chunks) => writes.push({ generation, chunks }),
    },
    {
      resolve: async (snapshot) => ({
        ...snapshot,
        endpoint: `http://127.0.0.1:${server.address().port}/v1`,
      }),
    },
    directory
  );
  t.after(() => runner.close());
  const before = database.db.select().from(entries).all();
  const generationId = catalog.getCollection(collection.id).activeGenerationId;
  const submitted = repository.enqueue('test', collection.id, 'subset', 'reindex', null, config, null, [
    ids[0],
  ]);
  runner.wake();
  for (
    let attempt = 0;
    attempt < 200 && ['queued', 'running'].includes(repository.get(submitted.id).state);
    attempt++
  )
    await delay(50);
  assert.equal(
    repository.get(submitted.id).state,
    'succeeded',
    JSON.stringify({ job: repository.get(submitted.id), leaves: repository.leaves(submitted.id) })
  );
  assert.ok(writes.length > 0);
  assert.ok(
    writes.every(
      (write) =>
        write.generation === generationId && write.chunks.every((chunk) => chunk.documentId === ids[0])
    )
  );
  assert.ok(requests.flatMap((request) => request.input).every((text) => text.includes('first')));
  assert.equal(catalog.getCollection(collection.id).activeGenerationId, generationId);
  assert.deepEqual(
    database.db
      .select()
      .from(entries)
      .all()
      .find((entry) => entry.documentId === ids[1]),
    before.find((entry) => entry.documentId === ids[1])
  );
  assert.equal(database.db.select().from(generations).all().length, 1);

  const failed = repository.enqueue('test', collection.id, 'failure', 'reindex', null, config, null, [
    ids[0],
  ]);
  const attempt = repository.claim();
  repository.generation(attempt);
  repository.finish(attempt, 'failed', 'DOCUMENT_FAILED');
  assert.equal(database.db.select().from(generations).get().state, 'active');
  repository.retry(failed.id, attempt.attempt);
  const retry = repository.claim();
  assert.deepEqual(retry.documentIds, [ids[0]]);
  assert.equal(repository.generation(retry).id, generationId);
  repository.cancel(retry.id);
  assert.equal(database.db.select().from(generations).get().state, 'active');
});
