/**
 * @author Codex
 * @description Acknowledges visible Session content without consuming notifications arriving concurrently.
 */
import { useEffect, useState } from 'react';
import { useDocumentVisibility, useEventListener } from 'ahooks';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { markSessionRead } from '@/api/notifications';
import type { SessionDto } from '@octopus/shared/protocol';

/**
 * Send the rendered version only after content is ready and the browser is focused.
 */
export function SessionReadReceipt({ session, ready }: { session: SessionDto; ready: boolean }) {
  const visibility = useDocumentVisibility();
  const [focusVersion, setFocusVersion] = useState(0);
  useEventListener('focus', () => setFocusVersion((value) => value + 1));
  useEventListener('blur', () => setFocusVersion((value) => value + 1));
  const client = useQueryClient();
  const receipt = useMutation({
    mutationFn: (version: number) => markSessionRead(session.workspaceId, session.id, version),
    retry: 2,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['sessions', session.workspaceId] });
      void client.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
  const version = session.notificationVersion ?? 0;
  const readVersion = session.readVersion ?? 0;
  const { mutate, isPending, variables } = receipt;
  useEffect(() => {
    if (
      ready &&
      document.hasFocus() &&
      visibility === 'visible' &&
      version > readVersion &&
      !isPending &&
      variables !== version
    ) {
      mutate(version);
    }
  }, [ready, focusVersion, visibility, version, readVersion, isPending, variables, mutate]);
  return null;
}
