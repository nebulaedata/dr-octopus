/**
 * @author Codex
 * @description Keeps Runtime lifecycle snapshots in one Query cache with bounded read retries.
 */
import { queryOptions } from '@tanstack/react-query';
import { readRuntimeStatus } from '@/api/executor';
import type { QueryClient } from '@tanstack/react-query';
import type { RuntimeSnapshot } from '../../../contracts/runtime';

export const runtimeStatusQuery = queryOptions({
  queryKey: ['executor', 'runtime-status'],
  queryFn: readRuntimeStatus,
  networkMode: 'always',
  staleTime: Infinity,
  retry: 1,
  refetchOnWindowFocus: 'always',
  refetchOnReconnect: 'always',
});

/**
 * Binds the window-owned Preload subscription to this Query cache and returns teardown.
 */
export function bindRuntimeStatus(client: QueryClient): () => void {
  const unsubscribe = window.executor?.onStatusChanged((snapshot) => {
    client.setQueryData<RuntimeSnapshot>(runtimeStatusQuery.queryKey, (current) => {
      return !current || snapshot.revision > current.revision ? snapshot : current;
    });
  });
  return () => {
    unsubscribe?.();
  };
}
