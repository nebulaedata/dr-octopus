/**
 * @author Codex
 * @description Authorized index snapshots and durable evidence references over control metadata.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { citations, documents, entries, generations } from '../db/schema.js';
import { KnowledgeError } from '../definitions/error.js';
import type { KnowledgeDatabase } from '../db/database.js';
import type { KnowledgeCatalogService } from '../services/catalog-service.js';
import type { KnowledgeContext, IndexedChunk, KnowledgeHit } from '../definitions/types.js';
import type { GenerationSnapshot } from '../definitions/port.js';

export class KnowledgeSearchRepository {
  /**
   * Scope checks remain in the catalog service and are repeated when evidence is read.
   */
  constructor(
    private readonly database: KnowledgeDatabase,
    private readonly catalog: KnowledgeCatalogService
  ) {}

  /**
   * Take current generation and live document revisions in one read transaction.
   */
  snapshot(context: KnowledgeContext, collectionId: string): GenerationSnapshot | null {
    return this.database.sqlite.transaction(() => {
      const parent = this.catalog.requireCollection(context, collectionId);
      if (!parent.activeGenerationId) {
        return null;
      }
      const generation = this.database.db
        .select()
        .from(generations)
        .where(eq(generations.id, parent.activeGenerationId))
        .get()!;
      const active = this.database.db
        .select({ revision: entries.indexRevision })
        .from(entries)
        .innerJoin(
          documents,
          and(eq(documents.id, entries.documentId), eq(documents.activeVersionId, entries.documentVersionId))
        )
        .where(and(eq(entries.generationId, generation.id), isNull(documents.deletedAt)))
        .all();
      return {
        id: generation.id,
        collectionId,
        config: generation.embeddingConfig,
        revisions: active.map((row) => row.revision),
      };
    })();
  }

  /**
   * Recheck revocation after asynchronous retrieval, then issue a seven-day immutable citation.
   */
  cite(context: KnowledgeContext, generationId: string, chunk: IndexedChunk): KnowledgeHit | null {
    this.catalog.requireCollection(context, chunk.collectionId);
    const document = this.database.db
      .select()
      .from(documents)
      .where(eq(documents.id, chunk.documentId))
      .get();
    if (!document || document.deletedAt) {
      return null;
    }
    const citationId = randomUUID();
    this.database.db
      .insert(citations)
      .values({
        id: citationId,
        collectionId: chunk.collectionId,
        generationId,
        documentId: chunk.documentId,
        documentVersionId: chunk.documentVersionId,
        chunkId: chunk.chunkId,
        locator: chunk.locator,
        expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      })
      .run();
    return { ...chunk, citationId, generationId, title: document.title, collectionRef: chunk.collectionId };
  }

  /**
   * Citation possession never grants access to another workspace or deleted content.
   */
  evidence(context: KnowledgeContext, id: string): typeof citations.$inferSelect {
    const citation = this.database.db.select().from(citations).where(eq(citations.id, id)).get();
    if (!citation || citation.expiresAt <= new Date().toISOString()) {
      throw new KnowledgeError('EVIDENCE_GONE', '引用已过期或不存在');
    }
    this.catalog.requireCollection(context, citation.collectionId);
    const document = this.database.db
      .select()
      .from(documents)
      .where(eq(documents.id, citation.documentId))
      .get();
    if (!document || document.deletedAt) {
      throw new KnowledgeError('EVIDENCE_GONE', '引用文档已删除');
    }
    return citation;
  }
}
