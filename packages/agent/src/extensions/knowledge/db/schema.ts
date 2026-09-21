/**
 * @author Codex
 * @description Daemon-owned control metadata; vectors and chunk text belong exclusively to LanceDB.
 */
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { EmbeddingConfig, KnowledgeModels, OcrConfig } from '../definitions/models.js';
import type { ImportSource, JobState, Locator } from '../definitions/types.js';
import type { KnowledgeSharing } from '@octopus/shared/protocol/knowledge';

export const collections = sqliteTable(
  'knowledge_collections',
  {
    id: text().primaryKey(),
    scopeKind: text({ enum: ['global', 'workspace'] }).notNull(),
    workspaceId: text(),
    name: text().notNull(),
    description: text().notNull().default(''),
    revision: integer().notNull().default(1),
    published: integer({ mode: 'boolean' }).notNull().default(false),
    activeGenerationId: text(),
    rebuildJobId: text(),
    createdAt: text().notNull(),
    deletedAt: text(),
  },
  (table) => [
    check(
      'knowledge_scope_valid',
      sql`(${table.scopeKind} = 'global' AND ${table.workspaceId} IS NULL) OR (${table.scopeKind} = 'workspace' AND ${table.workspaceId} IS NOT NULL)`
    ),
    index('knowledge_scope_page').on(table.scopeKind, table.workspaceId, table.createdAt, table.id),
  ]
);

export const documents = sqliteTable(
  'knowledge_documents',
  {
    id: text().primaryKey(),
    collectionId: text()
      .notNull()
      .references(() => collections.id),
    title: text().notNull(),
    format: text().notNull(),
    sourcePath: text().notNull().default(''),
    activeVersionId: text(),
    desiredVersionId: text(),
    revision: integer().notNull().default(1),
    status: text({ enum: ['queued', 'indexing', 'ready', 'failed', 'deleted'] })
      .notNull()
      .default('queued'),
    createdAt: text().notNull(),
    deletedAt: text(),
  },
  (table) => [index('knowledge_document_page').on(table.collectionId, table.createdAt, table.id)]
);

export const versions = sqliteTable('knowledge_document_versions', {
  id: text().primaryKey(),
  documentId: text()
    .notNull()
    .references(() => documents.id),
  sourceSha256: text().notNull(),
  parserVersion: text().notNull(),
  coverage: text().notNull().default('complete'),
  createdAt: text().notNull(),
  retiredAt: text(),
});

export const generations = sqliteTable('knowledge_index_generations', {
  id: text().primaryKey(),
  collectionId: text()
    .notNull()
    .references(() => collections.id),
  embeddingConfig: text({ mode: 'json' }).$type<EmbeddingConfig>().notNull(),
  fingerprint: text().notNull(),
  state: text({ enum: ['building', 'active', 'retired', 'failed'] }).notNull(),
  createdAt: text().notNull(),
  retiredAt: text(),
});

export const entries = sqliteTable(
  'knowledge_index_entries',
  {
    id: text().primaryKey(),
    generationId: text()
      .notNull()
      .references(() => generations.id),
    documentId: text()
      .notNull()
      .references(() => documents.id),
    documentVersionId: text()
      .notNull()
      .references(() => versions.id),
    indexRevision: text().notNull(),
    chunkCount: integer().notNull(),
  },
  (table) => [uniqueIndex('knowledge_generation_document').on(table.generationId, table.documentId)]
);

export const jobs = sqliteTable(
  'knowledge_jobs',
  {
    id: text().primaryKey(),
    collectionId: text()
      .notNull()
      .references(() => collections.id),
    principal: text().notNull(),
    kind: text({ enum: ['import', 'reindex', 'cleanup'] }).notNull(),
    idempotencyKey: text().notNull(),
    payloadHash: text().notNull(),
    state: text().$type<JobState>().notNull().default('queued'),
    stage: text().notNull().default('queued'),
    attempt: integer().notNull().default(0),
    automaticRetries: integer().notNull().default(0),
    cancelRequested: integer({ mode: 'boolean' }).notNull().default(false),
    blockedReason: text(),
    documentIds: text({ mode: 'json' }).$type<string[]>(),
    source: text({ mode: 'json' }).$type<ImportSource>(),
    ocrSnapshot: text({ mode: 'json' }).$type<OcrConfig>(),
    embeddingSnapshot: text({ mode: 'json' }).$type<EmbeddingConfig>(),
    targetGenerationId: text(),
    error: text(),
    createdAt: text().notNull(),
    finishedAt: text(),
  },
  (table) => [
    uniqueIndex('knowledge_job_request').on(table.principal, table.kind, table.idempotencyKey),
    index('knowledge_job_queue').on(table.state, table.createdAt),
  ]
);

export const importItems = sqliteTable(
  'knowledge_import_items',
  {
    id: text().primaryKey(),
    jobId: text()
      .notNull()
      .references(() => jobs.id),
    entryKey: text().notNull(),
    archivePath: text().notNull(),
    documentId: text(),
    documentVersionId: text(),
    status: text({ enum: ['queued', 'running', 'succeeded', 'failed', 'skipped', 'cancelled'] }).notNull(),
    attempt: integer().notNull().default(0),
    reason: text(),
  },
  (table) => [uniqueIndex('knowledge_import_leaf').on(table.jobId, table.entryKey)]
);

export const blobs = sqliteTable(
  'knowledge_blobs',
  {
    sha256: text().primaryKey(),
    md5: text(),
    size: integer().notNull(),
    createdAt: text().notNull(),
  },
  (table) => [index('knowledge_blob_md5').on(table.md5)]
);

export const settings = sqliteTable('knowledge_settings', {
  id: integer().primaryKey(),
  models: text({ mode: 'json' }).$type<KnowledgeModels>().notNull(),
});

export const citations = sqliteTable('knowledge_citations', {
  id: text().primaryKey(),
  collectionId: text().notNull(),
  generationId: text().notNull(),
  documentId: text().notNull(),
  documentVersionId: text().notNull(),
  chunkId: text().notNull(),
  locator: text({ mode: 'json' }).$type<Locator>().notNull(),
  expiresAt: text().notNull(),
});

export const mounts = sqliteTable('knowledge_remote_mounts', {
  id: text().primaryKey(),
  connectionRef: text().notNull(),
  instanceId: text().notNull().unique(),
  enabled: integer({ mode: 'boolean' }).notNull().default(true),
  catalog: text({ mode: 'json' }).$type<{ id: string; name: string; description: string }[]>().notNull(),
  lastSuccessAt: text(),
  error: text(),
});

export const sharing = sqliteTable('knowledge_sharing', {
  id: integer().primaryKey(),
  config: text({ mode: 'json' }).$type<KnowledgeSharing>().notNull(),
  tokenHash: text(),
});

export const remoteCitations = sqliteTable('knowledge_remote_citations', {
  id: text().primaryKey(),
  mountId: text()
    .notNull()
    .references(() => mounts.id, { onDelete: 'cascade' }),
  collectionId: text().notNull(),
  remoteReadRef: text().notNull(),
  expiresAt: text().notNull(),
});
