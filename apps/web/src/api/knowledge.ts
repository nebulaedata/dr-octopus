/**
 * @author Codex
 * @description Knowledge HTTP operations with independent scope, model configuration and import ownership.
 */
import { request } from '../utils/request';
import { uploadKnowledgeSource } from './knowledge-upload';
import type {
  KnowledgeCollection,
  KnowledgeDocument,
  KnowledgeJob,
  KnowledgeModels,
  KnowledgeServiceStatus,
  EmbeddingConfig,
  OcrConfig,
  RerankerConfig,
  Page,
  KnowledgeSearchResult,
} from '@octopus/shared/protocol/knowledge';

/**
 * Save collection metadata under the currently displayed revision.
 */
export function updateKnowledgeCollection(
  workspaceId: string | undefined,
  collection: KnowledgeCollection,
  patch: { name: string; description: string }
): Promise<KnowledgeCollection> {
  return request({
    url: knowledgeBase(workspaceId) + `/collections/${encodeURIComponent(collection.id)}`,
    method: 'PATCH',
    data: { revision: collection.revision, patch },
  });
}

/**
 * Test retrieval only within explicitly selected collections.
 */
export function searchKnowledge(
  workspaceId: string | undefined,
  collectionIds: string[],
  query: string,
  signal?: AbortSignal
): Promise<KnowledgeSearchResult> {
  return request({
    url: knowledgeBase(workspaceId) + '/search',
    method: 'POST',
    signal,
    data: { collectionIds, query, limit: 8 },
    timeout: 120_000,
  });
}

/**
 * Derive the management route from an explicit scope selected by the user.
 */
export function knowledgeBase(workspaceId?: string): string {
  return workspaceId ? `/workspaces/${encodeURIComponent(workspaceId)}/knowledge` : '/knowledge/global';
}

/**
 * Load an ordinary collection page without sharing cache identity with ordinary Agent sessions.
 */
export function listKnowledgeCollections(
  workspaceId?: string,
  page = 1,
  signal?: AbortSignal
): Promise<Page<KnowledgeCollection>> {
  return request({
    url: knowledgeBase(workspaceId) + '/collections',
    params: { page, pageSize: 20 },
    signal,
  });
}

/**
 * Resolve selected collection identities independently of the current catalog page.
 */
export function getKnowledgeCollection(
  workspaceId: string,
  id: string,
  signal?: AbortSignal
): Promise<KnowledgeCollection> {
  return request({ url: knowledgeBase(workspaceId) + `/collections/${encodeURIComponent(id)}`, signal });
}

/**
 * Create one collection in the selected management scope.
 */
export function createKnowledgeCollection(
  workspaceId: string | undefined,
  input: { name: string; description: string }
): Promise<KnowledgeCollection> {
  return request({ url: knowledgeBase(workspaceId) + '/collections', method: 'POST', data: input });
}

/**
 * List live documents and their indexing status with ordinary pagination.
 */
export function listKnowledgeDocuments(
  workspaceId: string | undefined,
  id: string,
  page: number,
  signal?: AbortSignal
): Promise<Page<KnowledgeDocument>> {
  return request({
    url: knowledgeBase(workspaceId) + `/collections/${encodeURIComponent(id)}/documents`,
    params: { page, pageSize: 20 },
    signal,
  });
}

/**
 * Upload raw bytes, then submit a retry-stable import request after source ownership is durable.
 */
export async function uploadKnowledgeDocument(
  workspaceId: string | undefined,
  collectionId: string,
  file: File,
  requestId: string,
  replacement?: KnowledgeDocument
): Promise<KnowledgeJob> {
  const blob = await uploadKnowledgeSource(knowledgeBase(workspaceId), file, requestId);
  const lower = file.name.toLowerCase();
  const format = lower.endsWith('.tar.gz') || lower.endsWith('.tgz') ? 'tgz' : lower.split('.').at(-1);
  return request({
    url: knowledgeBase(workspaceId) + `/collections/${encodeURIComponent(collectionId)}/imports`,
    method: 'POST',
    data: {
      requestId,
      source: {
        title: file.name,
        format,
        blobSha256: blob.sha256,
        ...(replacement ? { documentId: replacement.id, expectedRevision: replacement.revision } : {}),
      },
    },
  });
}

/**
 * Rename only the observed document revision; index content is unchanged.
 */
export function renameKnowledgeDocument(
  workspaceId: string | undefined,
  document: KnowledgeDocument,
  title: string
): Promise<KnowledgeDocument> {
  return request({
    url: knowledgeBase(workspaceId) + `/documents/${encodeURIComponent(document.id)}`,
    method: 'PATCH',
    data: { revision: document.revision, title },
  });
}

/**
 * Rebuild the full collection with current model settings, or selected documents with its active index configuration.
 */
export function reindexKnowledgeCollection(
  workspaceId: string | undefined,
  id: string,
  requestId: string,
  documentIds?: string[]
): Promise<KnowledgeJob> {
  return request({
    url: knowledgeBase(workspaceId) + `/collections/${encodeURIComponent(id)}/reindex`,
    method: 'POST',
    data: { requestId, ...(documentIds ? { documentIds } : {}) },
  });
}

/**
 * Delete with the user's observed revision so stale pages cannot overwrite newer changes.
 */
export function deleteKnowledgeResource(
  workspaceId: string | undefined,
  kind: 'collections' | 'documents',
  id: string,
  revision: number
): Promise<{ ok: true }> {
  return request({
    url: knowledgeBase(workspaceId) + `/${kind}/${encodeURIComponent(id)}`,
    method: 'DELETE',
    data: { revision },
  });
}

/**
 * Observe leaf-level outcomes without retrying a submitted import.
 */
export function getKnowledgeJob(
  workspaceId: string | undefined,
  id: string,
  signal?: AbortSignal
): Promise<{
  job: KnowledgeJob;
  leaves: { id: string; archivePath: string; status: string; reason: string | null }[];
}> {
  return request({ url: knowledgeBase(workspaceId) + `/jobs/${encodeURIComponent(id)}`, signal });
}

/**
 * Explicitly cancel or retry an observed durable indexing job.
 */
export function changeKnowledgeJob(
  workspaceId: string | undefined,
  job: KnowledgeJob,
  action: 'cancel' | 'retry'
): Promise<unknown> {
  return request({
    url: knowledgeBase(workspaceId) + `/jobs/${encodeURIComponent(job.id)}/${action}`,
    method: 'POST',
    data: action === 'retry' ? { expectedAttempt: job.attempt } : {},
  });
}

/**
 * Read model snapshots without returning secret plaintext.
 */
export function getKnowledgeModels(signal?: AbortSignal): Promise<KnowledgeModels> {
  return request({ url: '/settings/knowledge/models', signal });
}

/**
 * Persist exactly one model kind, preserving other settings under a revision check.
 */
export function saveKnowledgeModel(
  revision: number,
  config: EmbeddingConfig | OcrConfig | RerankerConfig
): Promise<KnowledgeModels> {
  return request({ url: '/settings/knowledge/models', method: 'PUT', data: { revision, config } });
}

/**
 * Probe edited model parameters with synthetic samples; this does not save them or index any user data.
 */
export function probeKnowledgeModel(
  config: EmbeddingConfig | OcrConfig | RerankerConfig
): Promise<{ kind: string; elapsedMs: number; summary: string }> {
  return request({
    url: '/settings/knowledge/models/probe',
    method: 'POST',
    data: { config },
    timeout: 125_000,
  });
}

/**
 * Status is read-only; explicit lifecycle actions follow the same singleton owner used by the CLI.
 */
export function knowledgeService(
  action: 'status' | 'health' | 'start' | 'stop' | 'restart',
  signal?: AbortSignal
): Promise<KnowledgeServiceStatus> {
  return request({
    url: `/settings/knowledge/service/${action}`,
    method: action === 'status' || action === 'health' ? 'GET' : 'POST',
    signal,
    timeout: 40_000,
  });
}
