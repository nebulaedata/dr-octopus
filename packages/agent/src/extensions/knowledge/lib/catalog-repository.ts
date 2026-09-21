/**
 * @author Codex
 * @description Transactional catalog pagination and visibility revocation without LanceDB coupling.
 */
import { and, count, desc, eq, isNull, like, or, sql } from 'drizzle-orm';
import { collections, documents, jobs } from '../db/schema.js';
import { KnowledgeError } from '../definitions/error.js';
import { remoteCollections } from './mcp/mount-store.js';
import type { KnowledgeDatabase } from '../db/database.js';
import type { CatalogRepository } from '../definitions/port.js';
import type { KnowledgeCollection, KnowledgeDocument, KnowledgeScope, Page } from '../definitions/types.js';

/**
 * Convert storage scope columns into the domain's discriminated union.
 */
function collection(row: typeof collections.$inferSelect): KnowledgeCollection {
  return {
    ...row,
    scope:
      row.scopeKind === 'global' ? { kind: 'global' } : { kind: 'workspace', workspaceId: row.workspaceId! },
  };
}

export class SqliteCatalogRepository implements CatalogRepository {
  /**
   * Borrow the singleton owner's database; this repository never closes it.
   */
  constructor(private readonly database: KnowledgeDatabase) {}

  /**
   * Read a catalog row without widening its visibility.
   */
  getCollection(id: string): KnowledgeCollection | null {
    const row = this.database.db.select().from(collections).where(eq(collections.id, id)).get();
    return row ? collection(row) : (remoteCollections(this.database).find((item) => item.id === id) ?? null);
  }

  /**
   * Select count and page from the same SQLite read transaction.
   */
  listCollections(scopes: KnowledgeScope[], page: number, pageSize: number): Page<KnowledgeCollection> {
    const where = and(
      isNull(collections.deletedAt),
      or(
        ...scopes.map((scope) =>
          scope.kind === 'global'
            ? eq(collections.scopeKind, 'global')
            : and(eq(collections.scopeKind, 'workspace'), eq(collections.workspaceId, scope.workspaceId))
        )
      )
    );
    return this.database.sqlite.transaction(() => {
      const localCount = this.database.db.select({ count: count() }).from(collections).where(where).get()!
        .count;
      const remote = scopes.some((scope) => scope.kind === 'global') ? remoteCollections(this.database) : [];
      const offset = (page - 1) * pageSize;
      const local =
        offset < localCount
          ? this.database.db
              .select()
              .from(collections)
              .where(where)
              .orderBy(desc(collections.createdAt), desc(collections.id))
              .limit(pageSize)
              .offset(offset)
              .all()
              .map(collection)
          : [];
      const start = Math.max(0, offset - localCount);
      return {
        items: [...local, ...remote.slice(start, start + pageSize - local.length)],
        total: localCount + remote.length,
        page,
        pageSize,
      };
    })();
  }

  /**
   * Scope is stored once and cannot be changed by metadata updates.
   */
  createCollection(value: KnowledgeCollection): void {
    this.database.db
      .insert(collections)
      .values({
        ...value,
        scopeKind: value.scope.kind,
        workspaceId: value.scope.kind === 'workspace' ? value.scope.workspaceId : null,
      })
      .run();
  }

  /**
   * Reject stale edits rather than silently replacing concurrent changes.
   */
  updateCollection(
    id: string,
    revision: number,
    patch: Partial<Pick<KnowledgeCollection, 'name' | 'description' | 'published'>>
  ): KnowledgeCollection {
    const row = this.database.db
      .update(collections)
      .set({ ...patch, revision: revision + 1 })
      .where(and(eq(collections.id, id), eq(collections.revision, revision), isNull(collections.deletedAt)))
      .returning()
      .get();
    if (!row) {
      throw new KnowledgeError('REVISION_CONFLICT', '集合已修改，请刷新后重试');
    }
    return collection(row);
  }

  /**
   * Tombstone before asynchronous storage cleanup and fence all outstanding attempts.
   */
  deleteCollection(id: string, revision: number): void {
    this.database.sqlite.transaction(() => {
      const previous = this.getCollection(id);
      if (previous?.deletedAt) {
        return;
      }
      const result = this.database.db
        .update(collections)
        .set({
          deletedAt: new Date().toISOString(),
          revision: revision + 1,
          rebuildJobId: null,
          published: false,
        })
        .where(and(eq(collections.id, id), eq(collections.revision, revision)))
        .run();
      if (!result.changes) {
        throw new KnowledgeError('REVISION_CONFLICT', '集合已修改，请刷新后重试');
      }
      this.database.db
        .update(documents)
        .set({ deletedAt: new Date().toISOString(), status: 'deleted' })
        .where(eq(documents.collectionId, id))
        .run();
      this.invalidateJobs(id);
    })();
  }

  /**
   * Read immutable identity and current version pointers.
   */
  getDocument(id: string): KnowledgeDocument | null {
    return this.database.db.select().from(documents).where(eq(documents.id, id)).get() ?? null;
  }

  /**
   * Parameterized title filtering with ordinary page semantics.
   */
  listDocuments(collectionId: string, page: number, pageSize: number, query = ''): Page<KnowledgeDocument> {
    const where = and(
      eq(documents.collectionId, collectionId),
      isNull(documents.deletedAt),
      query ? like(documents.title, `%${query}%`) : undefined
    );
    return this.database.sqlite.transaction(() => ({
      items: this.database.db
        .select()
        .from(documents)
        .where(where)
        .orderBy(desc(documents.createdAt), desc(documents.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize)
        .all(),
      total: this.database.db.select({ count: count() }).from(documents).where(where).get()!.count,
      page,
      pageSize,
    }))();
  }

  /**
   * Deletion invalidates a concurrent rebuild so an old snapshot cannot resurrect content.
   */
  deleteDocument(id: string, revision: number): void {
    this.database.sqlite.transaction(() => {
      const document = this.getDocument(id);
      if (document?.deletedAt) {
        return;
      }
      if (!document || document.revision !== revision) {
        throw new KnowledgeError('REVISION_CONFLICT', '文档已修改，请刷新后重试');
      }
      this.database.db
        .update(documents)
        .set({ deletedAt: new Date().toISOString(), status: 'deleted', revision: revision + 1 })
        .where(eq(documents.id, id))
        .run();
      const parent = this.getCollection(document.collectionId)!;
      if (parent.rebuildJobId) {
        this.database.db
          .update(jobs)
          .set({ state: 'cancelled', cancelRequested: true, attempt: sql`${jobs.attempt} + 1` })
          .where(eq(jobs.id, parent.rebuildJobId))
          .run();
        this.database.db
          .update(collections)
          .set({ rebuildJobId: null })
          .where(eq(collections.id, parent.id))
          .run();
      }
    })();
  }

  /**
   * Rename display metadata without re-embedding text or changing document identity.
   */
  renameDocument(id: string, revision: number, title: string): KnowledgeDocument {
    if (!title.trim()) {
      throw new KnowledgeError('INVALID_INPUT', '文档名称不能为空');
    }
    const result = this.database.db
      .update(documents)
      .set({ title: title.trim(), revision: revision + 1 })
      .where(and(eq(documents.id, id), eq(documents.revision, revision), isNull(documents.deletedAt)))
      .returning()
      .get();
    if (!result) {
      throw new KnowledgeError('REVISION_CONFLICT', '文档已变更，请刷新');
    }
    return result;
  }

  /**
   * Invalidate only unfinished work, preserving successful import history.
   */
  private invalidateJobs(collectionId: string): void {
    this.database.db
      .update(jobs)
      .set({ state: 'cancelled', cancelRequested: true, attempt: sql`${jobs.attempt} + 1` })
      .where(
        and(
          eq(jobs.collectionId, collectionId),
          or(eq(jobs.state, 'queued'), eq(jobs.state, 'running'), eq(jobs.state, 'waiting_dependency'))
        )
      )
      .run();
  }
}
