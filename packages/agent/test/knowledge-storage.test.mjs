/**
 * @author Codex
 * @description Real SQLite/Lance regressions for scope isolation, CAS and unpublished-index visibility.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openKnowledgeDatabase } from '../dist/extensions/knowledge/db/database.js';
import { SqliteCatalogRepository } from '../dist/extensions/knowledge/lib/catalog-repository.js';
import { KnowledgeCatalogService } from '../dist/extensions/knowledge/services/catalog-service.js';
import { LanceKnowledgeIndex } from '../dist/extensions/knowledge/lib/lance-index.js';
import { KnowledgeJobRepository } from '../dist/extensions/knowledge/lib/job-repository.js';

test('catalog rejects cross-workspace access and stale metadata writes across restart', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-knowledge-db-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let database = openKnowledgeDatabase(join(directory, 'control.sqlite'));
  const context = { principal: 'test', workspaceId: 'w1', globalWrite: false, modelAccess: 'none' };
  const service = new KnowledgeCatalogService(new SqliteCatalogRepository(database));
  const item = service.create(context, { kind: 'workspace', workspaceId: 'w1' }, '知识集合');
  assert.throws(() => service.create(context, { kind: 'global' }, 'private'), { code: 'FORBIDDEN' });
  assert.throws(() => service.requireCollection({ ...context, workspaceId: 'w2' }, item.id), {
    code: 'NOT_FOUND',
  });
  assert.equal(service.list({ ...context, workspaceId: 'w2' }).total, 0);
  service.update(context, item.id, 1, { name: 'new' });
  assert.throws(() => service.update(context, item.id, 1, { name: 'stale' }), { code: 'REVISION_CONFLICT' });
  database.sqlite.close();
  database = openKnowledgeDatabase(join(directory, 'control.sqlite'));
  try {
    assert.equal(new SqliteCatalogRepository(database).getCollection(item.id).name, 'new');
  } finally {
    database.sqlite.close();
  }
});

test('Lance filters unpublished revisions before top-k and retrieves Chinese text', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-knowledge-lance-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const index = await LanceKnowledgeIndex.open(directory);
  const chunk = {
    chunkId: 'active',
    documentId: 'doc',
    documentVersionId: 'v1',
    collectionId: 'collection',
    indexRevision: 'published',
    text: '知识库支持扫描文档',
    locator: { page: 2 },
    extractionMethod: 'text',
    ordinal: 0,
  };
  try {
    await index.write('generation', [chunk], [[1, 0]]);
    await index.write(
      'generation',
      [{ ...chunk, chunkId: 'hidden', indexRevision: 'unpublished' }],
      [[1, 0]]
    );
    const results = await index.search('generation', ['published'], '扫描', [1, 0]);
    assert.equal(results.length, 2);
    assert.ok(results.every((list) => list.length && list.every((row) => row.chunkId === 'active')));
    assert.deepEqual((await index.read('generation', 'active')).locator, { page: 2 });
    await index.write('generation', [chunk], [[1, 0]]);
    assert.equal((await index.search('generation', ['published'], '扫描'))[0].length, 1);
    await index.write(
      'generation',
      [{ ...chunk, chunkId: 'batch-one', indexRevision: 'batched' }],
      [[1, 0]],
      false
    );
    assert.ok(
      (await index.search('generation', ['published'], '扫描'))[0].every((row) => row.chunkId === 'active')
    );
    await index.write(
      'generation',
      [{ ...chunk, chunkId: 'batch-two', indexRevision: 'batched', ordinal: 1 }],
      [[1, 0]],
      true
    );
    assert.equal((await index.search('generation', ['batched'], '扫描'))[0].length, 2);
    await index.write(
      'generation',
      [{ ...chunk, chunkId: 'batch-two', indexRevision: 'batched', ordinal: 1 }],
      [[1, 0]],
      true
    );
    assert.equal((await index.search('generation', ['batched'], '扫描'))[0].length, 2);
  } finally {
    index.close();
  }
});

test('retrying an old failed import cannot claim a document version created by a later replacement', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-knowledge-fence-'));
  const database = openKnowledgeDatabase(join(root, 'control.sqlite'));
  t.after(async () => {
    database.sqlite.close();
    await rm(root, { recursive: true, force: true });
  });
  const catalog = new SqliteCatalogRepository(database);
  const collection = new KnowledgeCatalogService(catalog).create(
    { principal: 'test', globalWrite: true, modelAccess: 'none' },
    { kind: 'global' },
    'versions'
  );
  const repository = new KnowledgeJobRepository(database);
  const config = {
    kind: 'embedding',
    endpoint: 'http://localhost/v1',
    model: 'test',
    dimensions: 2,
    batchSize: 1,
  };
  const source = { title: 'old.md', format: 'md', blobSha256: 'a'.repeat(64) };
  repository.enqueue('test', collection.id, 'first', 'import', source, config, null);
  const first = repository.claim();
  const leaf = repository.leaf(first, 'first', 'old.md');
  const document = repository.prepareDocument(first, leaf, source);
  repository.finish(first, 'failed');
  const replacement = {
    ...source,
    blobSha256: 'b'.repeat(64),
    documentId: document.documentId,
    expectedRevision: catalog.getDocument(document.documentId).revision,
  };
  repository.enqueue('test', collection.id, 'second', 'import', replacement, config, null);
  const second = repository.claim();
  const newLeaf = repository.leaf(second, 'second', 'new.md');
  const newer = repository.prepareDocument(second, newLeaf, replacement);
  repository.finish(second, 'failed');
  repository.retry(first.id, first.attempt);
  const retried = repository.claim();
  assert.throws(() => repository.prepareDocument(retried, repository.leaves(first.id)[0], source), {
    code: 'DOCUMENT_CHANGED',
  });
  assert.equal(catalog.getDocument(document.documentId).desiredVersionId, newer.versionId);
});
