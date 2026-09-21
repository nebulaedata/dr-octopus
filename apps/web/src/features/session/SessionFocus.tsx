/**
 * @author Codex
 * @description Synchronizes the current interactive Session and browser focus with its connection.
 */
import { useEffect } from 'react';
import { useEventListener, useMemoizedFn } from 'ahooks';
import { realtimeClient } from '@/utils/realtime-client';

/**
 * Treat a focused Session page as being read; leaving the route clears its focus intent.
 */
export function SessionFocus({ sessionId }: { sessionId: string }) {
  const syncFocus = useMemoizedFn(() => {
    realtimeClient.setFocusedSession(document.hasFocus() ? sessionId : null);
  });
  useEventListener('focus', syncFocus);
  useEventListener('blur', () => realtimeClient.setFocusedSession(null));
  useEventListener('pagehide', () => realtimeClient.setFocusedSession(null));
  useEventListener('pageshow', syncFocus);
  useEffect(() => {
    syncFocus();
    return () => realtimeClient.setFocusedSession(null);
  }, [sessionId, syncFocus]);
  return null;
}
