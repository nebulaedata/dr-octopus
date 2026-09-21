/**
 * @author Codex
 * @description Host-neutral knowledge client contract; no storage or model runtime dependencies.
 */
import type { EmbeddingConfig, KnowledgeModels, OcrConfig, RerankerConfig } from './models.js';
import type { KnowledgeMount, KnowledgeSharing, RemoteCollection } from './mcp.js';
import type {
  ImportSource,
  IndexedChunk,
  KnowledgeCollection,
  KnowledgeContext,
  KnowledgeDocument,
  KnowledgeJob,
  KnowledgeScope,
  KnowledgeSearchResult,
  Page,
} from './types.js';

export interface KnowledgeOperations {
  'collections.get': { input: { id: string }; output: KnowledgeCollection };
  'sharing.get': { input: Record<string, never>; output: KnowledgeSharing };
  'sharing.save': {
    input: {
      revision: number;
      enabled: boolean;
      collectionIds: string[];
      network: 'loopback' | 'tls';
      allowedHosts: string[];
      allowedOrigins: string[];
      rotateToken?: boolean;
    };
    output: { settings: KnowledgeSharing; token?: string };
  };
  'sharing.authorize': { input: { token: string }; output: KnowledgeSharing };
  'sharing.catalog': {
    input: { token: string };
    output: { settings: KnowledgeSharing; items: RemoteCollection[]; revision: string };
  };
  'mounts.connections': { input: Record<string, never>; output: { name: string; available: boolean }[] };
  'mounts.list': { input: Record<string, never>; output: KnowledgeMount[] };
  'mounts.create': { input: { connectionRef: string }; output: KnowledgeMount };
  'mounts.refresh': { input: { id: string }; output: KnowledgeMount };
  'mounts.delete': { input: { id: string }; output: { ok: true } };
  'collections.list': {
    input: { page?: number; pageSize?: number; scope?: KnowledgeScope };
    output: Page<KnowledgeCollection>;
  };
  'collections.create': {
    input: { scope: KnowledgeScope; name: string; description?: string };
    output: KnowledgeCollection;
  };
  'collections.update': {
    input: {
      id: string;
      revision: number;
      patch: Partial<Pick<KnowledgeCollection, 'name' | 'description' | 'published'>>;
    };
    output: KnowledgeCollection;
  };
  'collections.delete': { input: { id: string; revision: number }; output: { ok: true } };
  'documents.list': {
    input: { collectionId: string; page?: number; pageSize?: number; query?: string };
    output: Page<KnowledgeDocument>;
  };
  'documents.delete': { input: { id: string; revision: number }; output: { ok: true } };
  'documents.update': { input: { id: string; revision: number; title: string }; output: KnowledgeDocument };
  'jobs.import': {
    input: { collectionId: string; requestId: string; source: ImportSource };
    output: KnowledgeJob;
  };
  'jobs.importAttachment': {
    input: { collectionId: string; requestId: string; attachmentRef: string };
    output: KnowledgeJob;
  };
  'jobs.reindex': {
    input: { collectionId: string; requestId: string; documentIds?: string[] };
    output: KnowledgeJob;
  };
  'jobs.get': {
    input: { id: string };
    output: {
      job: KnowledgeJob;
      leaves: {
        id: string;
        archivePath: string;
        documentId: string | null;
        status: string;
        reason: string | null;
      }[];
    };
  };
  'jobs.cancel': { input: { id: string }; output: { ok: true } };
  'jobs.retry': { input: { id: string; expectedAttempt: number }; output: KnowledgeJob };
  search: {
    input: { collectionIds: string[]; query: string; limit?: number };
    output: KnowledgeSearchResult;
  };
  read: { input: { citationId: string }; output: IndexedChunk };
  'settings.get': { input: Record<string, never>; output: KnowledgeModels };
  'settings.save': {
    input: { revision: number; config: EmbeddingConfig | OcrConfig | RerankerConfig };
    output: KnowledgeModels;
  };
  'settings.probe': {
    input: { config: EmbeddingConfig | OcrConfig | RerankerConfig };
    output: { kind: string; elapsedMs: number; summary: string };
  };
}

export interface KnowledgeClient {
  /**
   * Execute within the context fixed by the trusted Host when constructing the client.
   */
  call<K extends keyof KnowledgeOperations>(
    operation: K,
    input: KnowledgeOperations[K]['input'],
    signal?: AbortSignal
  ): Promise<KnowledgeOperations[K]['output']>;
  /**
   * Copy bytes into independent knowledge ownership before creating an import job.
   */
  upload(bytes: Uint8Array, signal?: AbortSignal): Promise<{ sha256: string; size: number }>;
}
export interface KnowledgeClientOptions {
  agentDir: string;
  context: KnowledgeContext;
  autostart?: boolean;
}
