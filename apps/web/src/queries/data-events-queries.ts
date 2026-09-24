/**
 * @author Codex
 * @description Owns the application business-data SSE connection independently of Conversation WebSocket.
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createDataEventsSync, parseDataChange } from '@/queries/utils/data-events-sync';

/**
 * EventSource owns reconnection; every ready event compensates for the preceding connection gap.
 */
export function useDataEventsLifecycle(): void {
  const client = useQueryClient();
  useEffect(() => {
    const sync = createDataEventsSync(client);
    let source: EventSource;
    let watchdog: ReturnType<typeof setTimeout>;
    /**
     * Recreate a silently stalled stream; EventSource handles ordinary disconnect retries itself.
     */
    function connect(): void {
      source?.close();
      source = new EventSource('/api/data/events');
      source.addEventListener('ready', () => {
        alive();
        sync.invalidate();
      });
      source.addEventListener('heartbeat', alive);
      source.addEventListener('change', (event: MessageEvent<string>) => {
        alive();
        const change = parseDataChange(event.data);
        if (change) {
          sync.invalidate(change);
        }
      });
      alive();
    }
    /**
     * Bound the time a half-open proxy or network connection can keep cached data stale.
     */
    function alive(): void {
      clearTimeout(watchdog);
      watchdog = setTimeout(connect, 45_000);
    }
    connect();
    return () => {
      clearTimeout(watchdog);
      source.close();
      sync.close();
    };
  }, [client]);
}
