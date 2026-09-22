/**
 * @author Codex
 * @description Global query identity and refresh behavior for memory across TUI and Web mutations.
 */
import { queryOptions } from '@tanstack/react-query';
import { getMemoryStatus, getMemoryIndexes, getMemoryDocument, memoryService } from '@/api/memory';
import type { MemoryRef } from '@octopus/shared/protocol/memory';
export const memoryQueryKey = ['memory'] as const;
/**
 * Observe service lifecycle independently of database policy and without implicit startup.
 */
export const memoryServiceQuery = () =>
  queryOptions({
    queryKey: [...memoryQueryKey, 'service'],
    queryFn: ({ signal }) => memoryService('status', signal),
  });
/**
 * Refresh global policy while its management page is visible.
 */
export const memoryStatusQuery = () =>
  queryOptions({
    queryKey: [...memoryQueryKey, 'status'],
    queryFn: ({ signal }) => getMemoryStatus(signal),
  });
/**
 * A mutation invalidates the whole directory; stale cursors require a deliberate restart.
 */
export const memoryIndexesQuery = (query: string, cursor?: string) =>
  queryOptions({
    queryKey: [...memoryQueryKey, 'indexes', query, cursor],
    queryFn: ({ signal }) => getMemoryIndexes(query, cursor, signal),
    retry: false,
  });
/**
 * Keep document identity bound to a store, never a Workspace.
 */
export const memoryDocumentQuery = (ref: MemoryRef) =>
  queryOptions({
    queryKey: [...memoryQueryKey, 'document', ref.storeId, ref.indexId],
    queryFn: ({ signal }) => getMemoryDocument(ref, signal),
    retry: false,
  });
