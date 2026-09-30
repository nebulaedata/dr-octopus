/**
 * @author Codex
 * @description Displays Pi Extension notification text inline within transcript separators.
 */

import { useStore } from 'zustand';
import { MessageScrollerItem } from '@octopus/ui/components/message-scroller';
import { sessionStores } from '@/stores/session';
import { Marker, MarkerContent, MarkerIcon } from '@octopus/ui/components/marker';
import { MegaphoneIcon } from 'lucide-react';

/**
 * Displays one non-interactive Extension notification without presenting it as an Agent message or tool call.
 *
 * @param props - Session and notification identities used to select the normalized projection.
 * @returns A notification separator, or nothing when its content is absent.
 */
export function ExtensionNotificationRow({
  notificationId,
  sessionId,
}: {
  notificationId: string;
  sessionId: string;
}) {
  const notification = useStore(
    sessionStores.ensure(sessionId),
    (state) => state.notificationsById[notificationId]
  );
  if (notification === undefined || notification.message.trim().length === 0) {
    return null;
  }
  return (
    <MessageScrollerItem>
      <Marker role="status" variant="separator" className="my-2">
        <MarkerIcon>
          <MegaphoneIcon />
        </MarkerIcon>
        <MarkerContent className="max-w-[80%] wrap-anywhere whitespace-pre-wrap text-xs">
          {notification.message}
        </MarkerContent>
      </Marker>
    </MessageScrollerItem>
  );
}
