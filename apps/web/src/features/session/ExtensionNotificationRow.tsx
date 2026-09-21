/**
 * @author Codex
 * @description Renders fire-and-forget Pi Extension notifications as compact Badge-labelled responses.
 */

import { useStore } from 'zustand';
import { Bubble, BubbleContent } from '@octopus/ui/components/bubble';
import { Message, MessageContent } from '@octopus/ui/components/message';
import { MessageScrollerItem } from '@octopus/ui/components/message-scroller';
import { sessionStores } from '@/stores/session';
import { RichContent } from './RichContent';
import { Marker, MarkerContent, MarkerIcon } from '@octopus/ui/components/marker';
import { MegaphoneIcon } from 'lucide-react';
import type { MessageProjection } from '@/stores/session';

/**
 * Displays one non-interactive Extension notification without presenting it as an Agent message or tool call.
 *
 * @param props - Session and notification identities used to select the normalized projection.
 * @returns A Badge-labelled notification response, or nothing when the projection no longer exists.
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
  if (notification === undefined) {
    return null;
  }
  const message: MessageProjection = {
    id: notification.id,
    role: 'custom',
    content: [{ type: 'text', text: notification.message }],
    timestamp: notification.timestamp,
  };
  return (
    <MessageScrollerItem>
      <Message align="start">
        <MessageContent>
          <Marker role="status" variant="separator" className="mb-5">
            <MarkerIcon>
              <MegaphoneIcon />
            </MarkerIcon>
            <MarkerContent className="text-xs tabular-nums">{'notify'}</MarkerContent>
          </Marker>
          {notification.message.trim().length > 0 && (
            <Bubble variant="muted" align="start">
              <BubbleContent>
                <RichContent isStreaming={false} message={message} />
              </BubbleContent>
            </Bubble>
          )}
        </MessageContent>
      </Message>
    </MessageScrollerItem>
  );
}
