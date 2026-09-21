/**
 * @author Codex
 * @description Knowledge domain values shared by local clients and the owning service.
 */
import type { EmbeddingConfig, OcrConfig } from './models.js';

export type KnowledgeScope = { kind: 'global' } | { kind: 'workspace'; workspaceId: string };
export type KnowledgeModelAccess = 'none' | 'invoke' | 'manage';
export interface KnowledgeContext {
  agentSessionId?: string;
  principal: string;
  workspaceId?: string;
  globalWrite: boolean;
  modelAccess: KnowledgeModelAccess;
}
export interface KnowledgeCollection {
  source?: 'local' | 'remote';
  mountId?: string;
  connectionRef?: string;
  remoteState?: 'ready' | 'unavailable';
  id: string;
  scope: KnowledgeScope;
  name: string;
  description: string;
  revision: number;
  published: boolean;
  activeGenerationId: string | null;
  rebuildJobId: string | null;
  createdAt: string;
  deletedAt: string | null;
}
export interface KnowledgeDocument {
  id: string;
  collectionId: string;
  title: string;
  format: string;
  sourcePath: string;
  activeVersionId: string | null;
  desiredVersionId: string | null;
  revision: number;
  status: 'queued' | 'indexing' | 'ready' | 'failed' | 'deleted';
  createdAt: string;
  deletedAt: string | null;
}
export interface Locator {
  page?: number;
  slide?: number;
  sheet?: string;
  row?: number;
  paragraph?: number;
  archivePath?: string;
}
export interface DocumentSection {
  text: string;
  locator: Locator;
  extractionMethod: 'text' | 'ocr';
}
export interface IndexedChunk {
  chunkId: string;
  documentId: string;
  documentVersionId: string;
  collectionId: string;
  indexRevision: string;
  text: string;
  locator: Locator;
  extractionMethod: 'text' | 'ocr';
  ordinal: number;
}
export interface KnowledgeHit extends IndexedChunk {
  citationId: string;
  generationId: string;
  title: string;
  collectionRef: string;
}
export type JobState =
  'queued' | 'running' | 'waiting_dependency' | 'succeeded' | 'partial' | 'failed' | 'cancelled';
export interface ImportSource {
  title: string;
  format: string;
  blobSha256: string;
  archivePath?: string;
  documentId?: string;
  expectedRevision?: number;
}
export interface KnowledgeJob {
  id: string;
  collectionId: string;
  principal: string;
  kind: 'import' | 'reindex' | 'cleanup';
  state: JobState;
  stage: string;
  attempt: number;
  cancelRequested: boolean;
  blockedReason: string | null;
  source: ImportSource | null;
  /**
   * Null or omitted rebuilds the collection; a nonempty list rebuilds only these documents in place.
   */
  documentIds?: string[] | null;
  ocrSnapshot: OcrConfig | null;
  embeddingSnapshot: EmbeddingConfig | null;
  targetGenerationId: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}
export interface KnowledgeSearchResult {
  hits: KnowledgeHit[];
  coverage: 'complete' | 'partial' | 'unavailable';
  sources: { collectionRef: string; state: 'ready' | 'unavailable'; reason?: string }[];
  warnings: string[];
  queryId: string;
  ranking: { strategy: 'rrf' | 'reranker'; configRevision: number; degraded: boolean };
}
export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
