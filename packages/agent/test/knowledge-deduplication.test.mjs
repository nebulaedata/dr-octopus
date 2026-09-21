/**
 * @author Codex
 * @description Real SQLite and application regressions for content deduplication, concurrent admission and retries.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openKnowledgeDatabase } from '../dist/extensions/knowledge/db/database.js';
import { KnowledgeBlobStore } from '../dist/extensions/knowledge/lib/blob-store.js';
import { SqliteCatalogRepository } from '../dist/extensions/knowledge/lib/catalog-repository.js';
import { KnowledgeCatalogService } from '../dist/extensions/knowledge/services/catalog-service.js';
import { KnowledgeJobRepository } from '../dist/extensions/knowledge/lib/job-repository.js';
import { rememberKnowledgeSource } from '../dist/extensions/knowledge/lib/import-deduplication.js';
import { createKnowledgeApplication } from '../dist/extensions/knowledge/daemon/application.js';

const config = {
  kind: 'embedding',
  endpoint: 'http://127.0.0.1:1/v1',
  model: 'fixture',
  dimensions: 2,
  batchSize: 1,
  timeoutMs: 1000,
};
const duplicate = { code: 'DOCUMENT_DUPLICATE_CONFLICT', message: '该文档已存在或正在导入，请勿重复上传' };

/**
 * Keep every test's real database and original bytes isolated from the user's knowledge service.
 */
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'octopus-knowledge-dedup-'));
  const database = openKnowledgeDatabase(join(root, 'control.sqlite'));
  const blobs = new KnowledgeBlobStore(root);
  const catalog = new SqliteCatalogRepository(database);
  const service = new KnowledgeCatalogService(catalog);
  const context = { principal: 'test', globalWrite: true, modelAccess: 'manage' };
  const collection = service.create(context, { kind: 'global' }, 'dedup');
  const jobs = new KnowledgeJobRepository(database);
  t.after(async () => {
    database.sqlite.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    database,
    catalog,
    service,
    context,
    collection,
    jobs,
    /**
     * Fingerprint real owned bytes just like production import admission.
     */
    async source(text = 'same document', title = 'original.md') {
      const blob = await blobs.put(Buffer.from(text));
      await rememberKnowledgeSource(database, blobs, blob.sha256);
      return { title, format: 'md', blobSha256: blob.sha256 };
    },
    /**
     * Admit a fresh request unless a specific replay key is supplied.
     */
    enqueue(source, key = randomUUID(), collectionId = collection.id) {
      return jobs.enqueue('test', collectionId, key, 'import', source, config, null);
    },
  };
}

test('MD5 persists, renamed pending duplicates are rejected, and request replays remain idempotent', async (t) => {
  const f = await fixture(t);
  const source = await f.source();
  const hash = f.database.sqlite
    .prepare('SELECT md5 FROM knowledge_blobs WHERE sha256 = ?')
    .get(source.blobSha256);
  assert.equal(hash.md5, createHash('md5').update('same document').digest('hex'));
  const first = f.enqueue(source, 'request');
  assert.equal(f.enqueue(source, 'request').id, first.id);
  assert.throws(() => f.enqueue({ ...source, title: 'renamed.txt', format: 'txt' }), duplicate);
  assert.throws(() => f.enqueue({ ...source, title: 'changed.md' }, 'request'), {
    code: 'IDEMPOTENCY_CONFLICT',
  });
  assert.equal(f.database.sqlite.prepare('SELECT count(*) AS n FROM knowledge_jobs').get().n, 1);
  const other = f.service.create(
    { ...f.context, workspaceId: 'w2' },
    { kind: 'workspace', workspaceId: 'w2' },
    'other'
  );
  assert.ok(f.enqueue(source, randomUUID(), other.id));
  assert.ok(f.enqueue(await f.source('changed document')));
});

test('live and legacy documents block duplicates after restart; deletion allows a fresh import', async (t) => {
  const f = await fixture(t);
  const source = await f.source();
  f.enqueue(source);
  const job = f.jobs.claim();
  const leaf = f.jobs.leaf(job, 'leaf', source.title);
  const doc = f.jobs.prepareDocument(job, leaf, source);
  f.jobs.finish(job, 'succeeded');
  // Simulate old persisted sources without MD5 and loss of any in-memory admission state.
  f.database.sqlite.prepare('DELETE FROM knowledge_blobs').run();
  const reopened = openKnowledgeDatabase(join(f.root, 'control.sqlite'));
  try {
    const restarted = new KnowledgeJobRepository(reopened);
    assert.throws(
      () => restarted.enqueue('test', f.collection.id, 'new', 'import', source, config, null),
      duplicate
    );
  } finally {
    reopened.sqlite.close();
  }
  f.catalog.deleteDocument(doc.documentId, f.catalog.getDocument(doc.documentId).revision);
  assert.ok(f.enqueue(source));
});

test('cancelled and failed admissions without documents do not permanently reserve their content', async (t) => {
  const f = await fixture(t);
  const source = await f.source();
  const first = f.enqueue(source);
  f.jobs.cancel(first.id);
  const second = f.enqueue(source);
  const running = f.jobs.claim();
  assert.equal(running.id, second.id);
  f.jobs.finish(running, 'failed');
  assert.ok(f.enqueue(source));
});

test('archive leaves cannot create duplicates and same-content replacements are rejected', async (t) => {
  const f = await fixture(t);
  const source = await f.source();
  const archive = { ...(await f.source('archive bytes')), title: 'archive.zip', format: 'zip' };
  f.enqueue(archive);
  const job = f.jobs.claim();
  const first = f.jobs.leaf(job, 'first', 'first.md');
  const doc = f.jobs.prepareDocument(job, first, source);
  assert.deepEqual(f.jobs.prepareDocument(job, f.jobs.leaves(job.id)[0], source), doc);
  const second = f.jobs.leaf(job, 'second', 'renamed.md');
  assert.throws(() => f.jobs.prepareDocument(job, second, { ...source, title: 'renamed.md' }), duplicate);
  f.jobs.finish(job, 'partial');
  assert.throws(() => f.enqueue(archive), duplicate);
  const replacement = { ...source, documentId: doc.documentId, expectedRevision: 1 };
  assert.throws(() => f.enqueue(replacement), duplicate);
  const changed = { ...(await f.source('new content')), documentId: doc.documentId, expectedRevision: 1 };
  f.enqueue(changed);
  const replacing = f.jobs.claim();
  const newLeaf = f.jobs.leaf(replacing, 'replacement', source.title);
  const newer = f.jobs.prepareDocument(replacing, newLeaf, changed);
  assert.equal(newer.documentId, doc.documentId);
  assert.notEqual(newer.versionId, doc.versionId);
});

test('MD5 matches are checked independently of SHA-256 storage addressing', async (t) => {
  const f = await fixture(t);
  // A deterministic persisted-hash fixture tests the MD5 lookup independently of SHA-256 equality.
  const first = await f.source('first');
  const second = await f.source('second');
  f.database.sqlite.prepare('UPDATE knowledge_blobs SET md5 = ?').run('a'.repeat(32));
  f.enqueue(first);
  assert.throws(() => f.enqueue(second), duplicate);
});

test('application admission rejects concurrent duplicate imports before creating a second job', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-knowledge-dedup-app-'));
  const app = await createKnowledgeApplication(root, join(root, 'agent'));
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const context = { principal: 'test', globalWrite: true, modelAccess: 'manage' };
  const call = (operation, input) => app.call({ context, operation, input });
  await call('settings.save', { revision: 0, config });
  const collection = await call('collections.create', { scope: { kind: 'global' }, name: 'concurrent' });
  // Hold the import gate to verify pending admission without requiring a model service.
  app.database.sqlite
    .prepare('UPDATE knowledge_collections SET rebuildJobId = ? WHERE id = ?')
    .run('held', collection.id);
  const blob = await app.upload(Buffer.from('concurrent original'));
  const inputs = ['first.md', 'renamed.md'].map((title) => ({
    collectionId: collection.id,
    requestId: randomUUID(),
    source: { title, format: 'md', blobSha256: blob.sha256 },
  }));
  const results = await Promise.allSettled(inputs.map((input) => call('jobs.import', input)));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.code, duplicate.code);
  const winner = results.findIndex((result) => result.status === 'fulfilled');
  assert.equal((await call('jobs.import', inputs[winner])).id, results[winner].value.id);
  assert.equal(app.database.sqlite.prepare('SELECT count(*) AS n FROM knowledge_jobs').get().n, 1);
});
