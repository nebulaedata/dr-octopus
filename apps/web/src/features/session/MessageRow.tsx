/**
 * @author Codex
 * @description Renders one normalized Session message while deferring failures owned by retry episodes.
 */

import { useStore } from 'zustand';
import { MessageScrollerItem } from '@octopus/ui/components/message-scroller';
import { sessionStores } from '@/stores/session';
import { MessageView } from './MessageView';
import type { MessageProjection } from '@/stores/session';
import type { SessionDto } from '@octopus/shared/protocol';

/**
 * Checks whether a message has anything worth rendering once streaming finishes.
 *
 * @param message The normalized message projection.
 * @param isStreaming Whether the message is still being generated.
 * @returns True when the message is streaming or carries non-empty content.
 */
function hasVisibleContent(message: MessageProjection, isStreaming: boolean): boolean {
  if (isStreaming || message.interrupted === true || message.errorMessage !== undefined) {
    return true;
  }
  return (
    (message.attachments?.length ?? 0) > 0 ||
    message.content.some((block) => {
      if (block.type === 'text' || block.type === 'thinking') {
        return block.text.trim().length > 0;
      }
      return block.type === 'image' || block.type === 'file';
    })
  );
}

/**
 * Subscribes to one message projection and uses bundled branding for the Agent identity.
 *
 * @param props Stable message identity plus its Session and Turn context.
 * @returns One transcript row, or null while a retry owns the transient failure.
 */
export function MessageRow({
  session,
  sessionId,
  messageId,
  turnId,
}: {
  session: SessionDto;
  sessionId: string;
  messageId: string;
  turnId?: string;
}) {
  const store = sessionStores.ensure(sessionId);
  const message = useStore(store, (state) => state.messagesById[messageId]);
  const isStreaming = useStore(store, (state) => state.currentAssistantId === messageId);
  const turnStatus = useStore(store, (state) =>
    turnId === undefined ? undefined : state.turnsById[turnId]?.status
  );
  const deferredFailure =
    message?.stopReason === 'error' &&
    message.interrupted !== true &&
    (message.retryId !== undefined || turnStatus === 'running');
  if (message === undefined || deferredFailure || !hasVisibleContent(message, isStreaming)) {
    return null;
  }
  return (
    <MessageScrollerItem messageId={messageId}>
      <MessageView session={session} message={message} isStreaming={isStreaming} />
    </MessageScrollerItem>
  );
}
