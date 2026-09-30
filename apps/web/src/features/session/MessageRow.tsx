/**
 * @author Codex
 * @description Renders one normalized Session message while deferring failures owned by retry episodes.
 */

import { useStore } from 'zustand';
import { MessageScrollerItem } from '@octopus/ui/components/message-scroller';
import { sessionStores } from '@/stores/session';
import { MessageView } from './MessageView';
import { isTranscriptMessageVisible } from './utils/transcript-layout';
import type { SessionDto } from '@octopus/shared/protocol';

/**
 * Subscribes to one message projection while preserving its timestamp and transcript context.
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
  if (!isTranscriptMessageVisible(message, isStreaming, turnStatus) || message === undefined) {
    return null;
  }
  return (
    <MessageScrollerItem messageId={messageId}>
      <MessageView session={session} message={message} isStreaming={isStreaming} />
    </MessageScrollerItem>
  );
}
