/**
 * @author Codex
 * @description Native retention regression preserves issued evidence and removes expired retired generations idempotently.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openKnowledgeDatabase } from '../dist/extensions/knowledge/db/database.js';
import { LanceKnowledgeIndex } from '../dist/extensions/knowledge/lib/lance-index.js';
import { maintainKnowledge } from '../dist/extensions/knowledge/lib/maintenance.js';
import {
  collections,
  documents,
  versions,
  generations,
  citations,
  entries,
} from '../dist/extensions/knowledge/db/schema.js';

test('maintenance retains live citations then reclaims their expired generation without touching the active index', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-knowledge-retention-'));
  const database = openKnowledgeDatabase(join(root, 'control.sqlite'));
  const index = await LanceKnowledgeIndex.open(join(root, 'lance'));
  t.after(async () => {
    index.close();
    database.sqlite.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  const now = Date.now();
  const old = new Date(now - 8 * 86_400_000).toISOString();
  database.db
    .insert(collections)
    .values({
      id: 'collection',
      scopeKind: 'global',
      name: 'retention',
      createdAt: old,
      activeGenerationId: 'active',
    })
    .run();
  database.db
    .insert(documents)
    .values({
      id: 'document',
      collectionId: 'collection',
      title: 'source',
      format: 'md',
      createdAt: old,
      activeVersionId: 'version',
      desiredVersionId: 'version',
    })
    .run();
  database.db
    .insert(versions)
    .values({
      id: 'version',
      documentId: 'document',
      sourceSha256: 'a'.repeat(64),
      parserVersion: 'v1',
      createdAt: old,
    })
    .run();
  const config = {
    kind: 'embedding',
    model: 'test',
    endpoint: 'http://localhost/v1',
    dimensions: 2,
    batchSize: 1,
  };
  for (const id of ['retired', 'active']) {
    database.db
      .insert(generations)
      .values({
        id,
        collectionId: 'collection',
        embeddingConfig: config,
        fingerprint: id,
        state: id === 'active' ? 'active' : 'retired',
        createdAt: old,
        retiredAt: id === 'retired' ? old : null,
      })
      .run();
    await index.write(
      id,
      [
        {
          chunkId: id,
          documentId: 'document',
          documentVersionId: 'version',
          collectionId: 'collection',
          indexRevision: 'revision',
          text: '保留证据',
          locator: {},
          ordinal: 0,
          extractionMethod: 'text',
        },
      ],
      [[1, 0]]
    );
  }
  database.db
    .insert(citations)
    .values({
      id: 'cite',
      collectionId: 'collection',
      generationId: 'retired',
      documentId: 'document',
      documentVersionId: 'version',
      chunkId: 'retired',
      locator: {},
      expiresAt: new Date(now + 1000).toISOString(),
    })
    .run();
  database.db
    .insert(entries)
    .values({
      id: 'entry',
      generationId: 'active',
      documentId: 'document',
      documentVersionId: 'version',
      indexRevision: 'revision',
      chunkCount: 1,
    })
    .run();
  await maintainKnowledge(database, index, root, now);
  assert.equal((await index.read('retired', 'retired')).text, '保留证据');
  await maintainKnowledge(database, index, root, now + 2000);
  assert.deepEqual(database.db.select({ id: generations.id }).from(generations).all(), [{ id: 'active' }]);
  await maintainKnowledge(database, index, root, now + 3000);
  assert.equal(database.db.select().from(citations).all().length, 0);
  assert.equal((await index.read('active', 'active')).text, '保留证据');
});
