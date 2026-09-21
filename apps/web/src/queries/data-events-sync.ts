/**
 * @author Codex
 * @description Reconciles SSE invalidation hints against authoritative HTTP queries without overlapping refreshes.
 */
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import type { DataChange } from '@octopus/shared/protocol';

const roots = new Set([
  'sessions',
  'notifications',
  'scheduled-tasks',
  'scheduler-service',
  'scheduler-settings',
]);

/**
 * Select only business projections; Conversation snapshots stay owned by their runtime lifecycle.
 */
export function matchesDataChange(key: QueryKey, change?: DataChange): boolean {
  if (!roots.has(String(key[0]))) {
    return false;
  }
  if (!change) {
    return true;
  }
  if (change.resource === 'sessions') {
    return key[0] === 'sessions' && (!change.workspaceId || key[1] === change.workspaceId);
  }
  if (change.resource === 'notifications') {
    return key[0] === 'notifications';
  }
  if (key[0] !== 'scheduled-tasks') {
    return key[0] === 'scheduler-service' || key[0] === 'scheduler-settings';
  }
  const workspace = key[1] === 'catalog' ? key[2] : key[1];
  return !change.workspaceId || !workspace || workspace === change.workspaceId;
}

/**
 * Own one coalescing queue; events received during a refresh always schedule a subsequent pass.
 */
export function createDataEventsSync(client: QueryClient, delay = 100) {
  let pending: (DataChange | undefined)[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let closed = false;

  /**
   * Cancel stale in-flight snapshots before refetching, including first loads with no cached data.
   */
  async function flush(): Promise<void> {
    timer = undefined;
    if (closed || running) {
      return;
    }
    running = true;
    const changes = pending;
    pending = [];
    const filters = {
      predicate: (query: { queryKey: QueryKey }) =>
        changes.some((change) => matchesDataChange(query.queryKey, change)),
    };
    try {
      await client.cancelQueries(filters);
      if (closed) {
        return;
      }
      await client.invalidateQueries({
        predicate: (query) => filters.predicate(query) && query.queryKey[0] === 'scheduler-service',
      });
      if (closed) {
        return;
      }
      const scheduler = client.getQueryData<{ state: string }>(['scheduler-service']);
      const unavailable = scheduler !== undefined && scheduler.state !== 'control-ready';
      if (unavailable) {
        await client.invalidateQueries({
          predicate: (query) => filters.predicate(query) && query.queryKey[0] === 'scheduled-tasks',
          refetchType: 'none',
        });
      }
      if (!closed) {
        await client.invalidateQueries({
          predicate: (query) =>
            filters.predicate(query) &&
            query.queryKey[0] !== 'scheduler-service' &&
            !(unavailable && query.queryKey[0] === 'scheduled-tasks'),
        });
      }
    } finally {
      running = false;
      if (!closed && pending.length) {
        schedule();
      }
    }
  }

  /**
   * Bound event batches while leaving an active refresh in control of the next pass.
   */
  function schedule(): void {
    if (!timer && !running) {
      timer = setTimeout(() => {
        void flush();
      }, delay);
    }
  }

  return {
    /**
     * Omitted change reconciles every business query after initial connection or reconnect.
     */
    invalidate(change?: DataChange): void {
      if (closed) {
        return;
      }
      if (!change) {
        pending = [undefined];
      } else if (
        !pending.includes(undefined) &&
        !pending.some((item) => item?.resource === change.resource && item.workspaceId === change.workspaceId)
      ) {
        pending.push(change);
      }
      schedule();
    },
    /**
     * Prevent delayed work after the owning application shell unmounts.
     */
    close(): void {
      closed = true;
      clearTimeout(timer);
      pending = [];
    },
  };
}
