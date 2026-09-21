/**
 * @author Codex
 * @description Narrow persistence and index boundaries consumed by knowledge use cases.
 */
import type { EmbeddingConfig } from './models.js';
import type { IndexedChunk, KnowledgeCollection, KnowledgeDocument, KnowledgeScope, Page } from './types.js';

export interface CatalogRepository {
  /**
   * Read a resource, including a tombstone for idempotent deletion.
   */
  getCollection(id: string): KnowledgeCollection | null;
  /**
   * Return a stable ordinary page within the caller's permitted scope.
   */
  listCollections(scopes: KnowledgeScope[], page: number, pageSize: number): Page<KnowledgeCollection>;
  /**
   * Persist a new collection with its immutable scope.
   */
  createCollection(value: KnowledgeCollection): void;
  /**
   * Apply a revision-checked metadata change.
   */
  updateCollection(
    id: string,
    revision: number,
    patch: Partial<Pick<KnowledgeCollection, 'name' | 'description' | 'published'>>
  ): KnowledgeCollection;
  /**
   * Revoke visibility and invalidate outstanding writes atomically.
   */
  deleteCollection(id: string, revision: number): void;
  /**
   * Read a document including its deletion marker.
   */
  getDocument(id: string): KnowledgeDocument | null;
  /**
   * Page the documents of an already authorized collection.
   */
  listDocuments(
    collectionId: string,
    page: number,
    pageSize: number,
    query?: string
  ): Page<KnowledgeDocument>;
  /**
   * Revoke a document and abort conflicting collection rebuilds.
   */
  deleteDocument(id: string, revision: number): void;
}

export interface KnowledgeIndex {
  /**
   * Write ordered idempotent batches of one unpublished revision; final defaults to true and rebuilds search metadata.
   */
  write(generationId: string, chunks: IndexedChunk[], vectors: number[][], final?: boolean): Promise<void>;
  /**
   * Search only explicitly active index revisions.
   */
  search(
    generationId: string,
    revisions: string[],
    query: string,
    vector?: number[]
  ): Promise<IndexedChunk[][]>;
  /**
   * Read a single immutable chunk after domain authorization.
   */
  read(generationId: string, chunkId: string): Promise<IndexedChunk | null>;
  /**
   * Remove one retired generation after its query pins expire.
   */
  remove(generationId: string): Promise<void>;
  /**
   * Release the owning connection on daemon shutdown.
   */
  close(): void;
}

export interface GenerationSnapshot {
  id: string;
  collectionId: string;
  config: EmbeddingConfig;
  revisions: string[];
}
