/**
 * @author Codex
 * @description Drizzle implementation of atomic global memory storage operations.
 */
import { and, count, desc, eq, lt, sql } from 'drizzle-orm';
import { setTimeout as delay } from 'node:timers/promises';
import { openMemoryDatabase } from './database.js';
import * as s from './schema.js';
import { MemoryError } from '../definitions/error.js';
import type { MemoryDatabase } from './database.js';
import type { MemoryRepository, MemoryTransaction } from '../definitions/port.js';
import type { MemoryDocument, MemoryIndex, MemoryReceipt } from '../definitions/types.js';
/**
 * Build transaction-scoped primitives; callers cannot retain a mutable database handle.
 */
function transaction(database: MemoryDatabase): MemoryTransaction {
  const db = database.db;
  /**
   * Read the mandatory singleton metadata.
   */
  const meta = () => {
    const value = db.select().from(s.memoryMeta).get();
    if (!value) {
      throw new MemoryError('STORE_UNAVAILABLE', '记忆数据库尚未初始化。');
    }
    return value;
  };
  /**
   * Project a database row to a safe navigation reference.
   */
  const index = (row: typeof s.memoryIndexes.$inferSelect): MemoryIndex => ({
    indexId: row.id,
    storeId: meta().storeId,
    canonicalKey: row.canonicalKey,
    topic: row.topic,
    type: row.type,
    indexText: row.indexText,
    revision: row.revision,
    activationSeq: row.activationSeq,
    updatedAt: row.updatedAt,
    status: row.status,
  });
  /**
   * Read a complete fact from the Section authority.
   */
  const get = (id: number): MemoryDocument | undefined => {
    const row = db.select().from(s.memoryIndexes).where(eq(s.memoryIndexes.id, id)).get();
    if (!row) {
      return;
    }
    const section = db.select().from(s.wikiSections).where(eq(s.wikiSections.id, row.sectionId)).get();
    if (!section) {
      throw new MemoryError('STORE_UNAVAILABLE', '记忆正文缺失。');
    }
    return {
      ...index(row),
      bodyMd: section.bodyMd,
      sources: db.select().from(s.memorySources).where(eq(s.memorySources.indexId, id)).get()?.values ?? [],
    };
  };
  return {
    meta,
    get,
    rebuildFts: () => {
      db.run(sql`DELETE FROM memory_fts`);
      db.run(
        sql`INSERT INTO memory_fts(rowid,indexText,topic,canonicalKey) SELECT id,indexText,topic,canonicalKey FROM memory_indexes WHERE status = 'active'`
      );
    },
    count: () =>
      db.select({ value: count() }).from(s.memoryIndexes).where(eq(s.memoryIndexes.status, 'active')).get()!
        .value,
    canonical: (key) => {
      const row = db
        .select()
        .from(s.memoryIndexes)
        .where(and(eq(s.memoryIndexes.canonicalKey, key), eq(s.memoryIndexes.status, 'active')))
        .get();
      return row ? get(row.id) : undefined;
    },
    page: (before, limit) =>
      db
        .select()
        .from(s.memoryIndexes)
        .where(
          and(
            eq(s.memoryIndexes.status, 'active'),
            before === undefined ? undefined : lt(s.memoryIndexes.activationSeq, before)
          )
        )
        .orderBy(desc(s.memoryIndexes.activationSeq))
        .limit(limit)
        .all()
        .map(index),
    search: (query) => {
      const words = query.match(/[\p{L}\p{N}_-]+/gu)?.slice(0, 8) ?? [];
      if (!words.length) {
        return [];
      }
      const expression = words.map((word) => '"' + word + '"').join(' OR ');
      const hits = db.all<{ id: number }>(
        sql`SELECT rowid as id FROM memory_fts WHERE memory_fts MATCH ${expression} ORDER BY rank LIMIT 20`
      );
      return hits.flatMap((hit) => {
        const row = db.select().from(s.memoryIndexes).where(eq(s.memoryIndexes.id, hit.id)).get();
        return row?.status === 'active' ? [index(row)] : [];
      });
    },
    save: (fact, id) => {
      const current = meta();
      const sequence = current.activationCounter + 1;
      db.update(s.memoryMeta).set({ activationCounter: sequence }).run();
      db.insert(s.wikiPages).values({ slug: fact.topic, title: fact.topic }).onConflictDoNothing().run();
      const page = db.select().from(s.wikiPages).where(eq(s.wikiPages.slug, fact.topic)).get()!;
      const previous =
        id === undefined
          ? undefined
          : db.select().from(s.memoryIndexes).where(eq(s.memoryIndexes.id, id)).get();
      const sectionId =
        previous?.sectionId ??
        db.insert(s.wikiSections).values({ pageId: page.id, bodyMd: fact.bodyMd }).returning().get().id;
      if (previous) {
        db.update(s.wikiSections)
          .set({ pageId: page.id, bodyMd: fact.bodyMd, revision: sql`revision + 1` })
          .where(eq(s.wikiSections.id, sectionId))
          .run();
      }
      const values = {
        canonicalKey: fact.canonicalKey,
        topic: fact.topic,
        type: fact.type,
        indexText: fact.indexText,
        sectionId,
        activationSeq: sequence,
        updatedAt: Date.now(),
      };
      const saved = previous
        ? db
            .update(s.memoryIndexes)
            .set({ ...values, revision: previous.revision + 1 })
            .where(eq(s.memoryIndexes.id, previous.id))
            .returning()
            .get()
        : db.insert(s.memoryIndexes).values(values).returning().get();
      db.insert(s.memorySources)
        .values({ indexId: saved.id, values: fact.sources })
        .onConflictDoUpdate({ target: s.memorySources.indexId, set: { values: fact.sources } })
        .run();
      return get(saved.id)!;
    },
    supersede: (id, replacement) => {
      db.update(s.memoryIndexes)
        .set({ status: 'superseded', supersededBy: replacement || null, revision: sql`revision + 1` })
        .where(eq(s.memoryIndexes.id, id))
        .run();
    },
    remove: (key) => {
      const rows = db.select().from(s.memoryIndexes).where(eq(s.memoryIndexes.canonicalKey, key)).all();
      const docs = rows.map((row) => get(row.id)!);
      for (const row of rows) {
        db.delete(s.memoryIndexes).where(eq(s.memoryIndexes.id, row.id)).run();
        db.delete(s.wikiSections).where(eq(s.wikiSections.id, row.sectionId)).run();
      }
      db.delete(s.wikiPages)
        .where(sql`NOT EXISTS (SELECT 1 FROM memory_wiki_sections WHERE pageId = memory_wiki_pages.id)`)
        .run();
      return docs;
    },
    blocked: (hash) => !!db.select().from(s.memoryBarriers).where(eq(s.memoryBarriers.hash, hash)).get(),
    fence: (hash, enabled) => {
      if (enabled) {
        db.insert(s.memoryBarriers).values({ hash }).onConflictDoNothing().run();
      } else {
        db.delete(s.memoryBarriers).where(eq(s.memoryBarriers.hash, hash)).run();
      }
    },
    receipt: (id) => {
      const row = db.select().from(s.memoryMutations).where(eq(s.memoryMutations.requestId, id)).get();
      return row ? { hash: row.hash, receipt: JSON.parse(row.receipt) as MemoryReceipt } : undefined;
    },
    record: (hash, receipt) => {
      db.insert(s.memoryMutations)
        .values({ requestId: receipt.requestId, hash, receipt: JSON.stringify(receipt) })
        .run();
    },
    advance: (input = {}) => {
      db.update(s.memoryMeta)
        .set({
          revision: sql`revision + 1`,
          ...(input.mode ? { mode: input.mode } : {}),
          ...(input.fence ? { writeEpoch: sql`writeEpoch + 1` } : {}),
        })
        .run();
      return meta();
    },
  };
}
/**
 * Hold one daemon-owned connection and serialize short transactions, including asynchronous busy retries.
 */
export function createMemoryRepository(
  directory: string,
  migrationsFolder?: string,
  onCommitted: () => void = () => undefined
): MemoryRepository {
  let closed = false;
  let database: MemoryDatabase | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  let pending = 0;
  /**
   * Bound the queue and never interleave transactions while retrying an external writer.
   */
  function run<T>(
    create: boolean,
    work: (tx: MemoryTransaction) => T,
    signal?: AbortSignal
  ): Promise<T | undefined> {
    if (closed) {
      return Promise.reject(new MemoryError('CANCELLED', '记忆服务已关闭。'));
    }
    if (pending >= 256) {
      return Promise.reject(new MemoryError('STORE_UNAVAILABLE', '记忆服务繁忙，请稍后重试。'));
    }
    pending++;
    const result = queue.then(async () => {
      for (let attempt = 0; attempt < 6; attempt++) {
        signal?.throwIfAborted();
        try {
          if (create && database?.sqlite.readonly) {
            database.sqlite.close();
            database = undefined;
          }
          database ??= await openMemoryDatabase(directory, create, migrationsFolder);
          if (!database) {
            return;
          }
          signal?.throwIfAborted();
          const connection = database;
          const result = connection.db.transaction(() => work(transaction(connection)), {
            behavior: create ? 'immediate' : 'deferred',
          });
          if (create) {
            try {
              onCommitted();
            } catch {
              /* Subscribers cannot undo a committed write. */
            }
          }
          return result;
        } catch (error) {
          if (error instanceof MemoryError || signal?.aborted) {
            throw error;
          }
          if ((error as { code?: string }).code === 'SQLITE_BUSY' && attempt < 5) {
            await delay(Math.min(50 * 2 ** attempt, 1000), undefined, { signal });
            continue;
          }
          throw new MemoryError('STORE_UNAVAILABLE', '记忆数据库不可用，请检查存储权限或稍后重试。', {
            cause: error,
          });
        }
      }
      throw new MemoryError('STORE_UNAVAILABLE', '记忆数据库繁忙。');
    });
    queue = result
      .catch(() => undefined)
      .finally(() => {
        pending--;
      });
    return result;
  }
  return {
    read: (work) => run(false, work),
    write: async (work, signal) => (await run(true, work, signal))!,
    dispose: async () => {
      closed = true;
      await queue;
      database?.sqlite.close();
      database = undefined;
    },
  };
}
