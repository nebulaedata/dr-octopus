/**
 * @author Codex
 * @description Drizzle-owned global memory facts, Wiki sections, receipts and deletion fences.
 */
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { MemorySource } from '../definitions/types.js';
export const memoryMeta = sqliteTable(
  'memory_meta',
  {
    id: integer().primaryKey(),
    storeId: text().notNull(),
    mode: text({ enum: ['off', 'manual', 'auto'] }).notNull(),
    revision: integer().notNull().default(0),
    activationCounter: integer().notNull().default(0),
    writeEpoch: integer().notNull().default(0),
  },
  (t) => [check('memory_singleton', sql`${t.id} = 1`)]
);
export const wikiPages = sqliteTable('memory_wiki_pages', {
  id: integer().primaryKey({ autoIncrement: true }),
  slug: text().notNull().unique(),
  title: text().notNull(),
});
export const wikiSections = sqliteTable('memory_wiki_sections', {
  id: integer().primaryKey({ autoIncrement: true }),
  pageId: integer()
    .notNull()
    .references(() => wikiPages.id),
  bodyMd: text().notNull(),
  revision: integer().notNull().default(1),
});
export const memoryIndexes = sqliteTable(
  'memory_indexes',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    canonicalKey: text().notNull(),
    topic: text().notNull(),
    type: text().notNull(),
    indexText: text().notNull(),
    sectionId: integer()
      .notNull()
      .unique()
      .references(() => wikiSections.id),
    status: text({ enum: ['active', 'superseded'] })
      .notNull()
      .default('active'),
    supersededBy: integer(),
    revision: integer().notNull().default(1),
    activationSeq: integer().notNull().unique(),
    updatedAt: integer().notNull(),
  },
  (t) => [
    index('memory_active_sequence').on(t.status, t.activationSeq),
    uniqueIndex('memory_active_canonical')
      .on(t.canonicalKey)
      .where(sql`${t.status} = 'active'`),
  ]
);
export const memorySources = sqliteTable('memory_sources', {
  indexId: integer()
    .primaryKey()
    .references(() => memoryIndexes.id, { onDelete: 'cascade' }),
  values: text({ mode: 'json' }).$type<MemorySource[]>().notNull(),
});
export const memoryMutations = sqliteTable('memory_mutations', {
  requestId: text().primaryKey(),
  hash: text().notNull(),
  receipt: text().notNull(),
});
export const memoryBarriers = sqliteTable('memory_forget_barriers', { hash: text().primaryKey() });
