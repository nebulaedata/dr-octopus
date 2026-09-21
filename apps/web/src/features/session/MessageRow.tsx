/**
 * @author Codex
 * @description Renders one normalized Session message while deferring failures owned by retry episodes.
 */

import { useStore } from 'zustand';
import { Bubble, BubbleContent } from '@octopus/ui/components/bubble';
import { Message, MessageContent, MessageFooter, MessageHeader } from '@octopus/ui/components/message';
import { MessageScrollerItem } from '@octopus/ui/components/message-scroller';
import { sessionStores } from '@/stores/session';
import { useI18n } from '@/i18n/use-i18n';
import { formatMessageTime } from '@/utils/date';
import { FileAttachment } from './FileAttachment';
import { ImageAttachment } from './ImageAttachment';
import { MessageAttachmentGroup } from './MessageAttachmentGroup';
import { MessageFailure } from './MessageFailure';
import { MessageToolbar } from './MessageToolbar';
import { MemorySaveCard } from './MemorySaveCard';
import { projectMemorySave } from './memory-save-projection';
import { RichContent } from './RichContent';
import type { ContentBlock, MessageProjection } from '@/stores/session';
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
  const { t } = useI18n();
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
  const memorySave = projectMemorySave(message);
  if (memorySave !== undefined) {
    return (
      <MessageScrollerItem messageId={messageId}>
        <Message align="start">
          <MessageContent className="p-1">
            <MemorySaveCard receipt={memorySave} timestamp={message.timestamp ?? message.persistedAt} />
          </MessageContent>
        </Message>
      </MessageScrollerItem>
    );
  }
  const isUserRole = message.role === 'user';
  const attachmentBlocks = message.content.filter(
    (block): block is Extract<ContentBlock, { type: 'image' } | { type: 'file' }> =>
      block.type === 'image' || block.type === 'file'
  );
  const hasTextContent =
    isStreaming || message.content.some((block) => block.type === 'text' || block.type === 'thinking');
  const hasResponseText = message.content.some(
    (block) => block.type === 'text' && block.text.trim().length > 0
  );
  return (
    <MessageScrollerItem messageId={messageId}>
      <Message align={isUserRole ? 'end' : 'start'}>
        <MessageContent>
          <MessageHeader>
            <div className="flex items-center gap-2">
              {isUserRole && (
                <span className="text-[11px]">
                  {message.timestamp && formatMessageTime(message.timestamp)}
                </span>
              )}
              <span className="text-primary font-semibold">
                {isUserRole ? t('session.messageRow.you', 'You') : 'Dr.Octopus'}
              </span>
            </div>
          </MessageHeader>
          {attachmentBlocks.map((block, index) =>
            block.type === 'image' ? (
              <ImageAttachment key={`attachment-${String(index)}`} block={block} />
            ) : (
              <FileAttachment key={`attachment-${String(index)}`} block={block} />
            )
          )}
          {message.attachments !== undefined && message.attachments.length > 0 ? (
            <MessageAttachmentGroup attachments={message.attachments} />
          ) : null}
          {hasTextContent && (
            <Bubble variant={isUserRole ? 'muted' : 'ghost'} align={isUserRole ? 'end' : 'start'}>
              <BubbleContent>
                <RichContent isStreaming={isStreaming} message={message} />
              </BubbleContent>
            </Bubble>
          )}
          {message.interrupted === true && (
            <p className="text-xs text-muted-foreground py-2 italic">
              {t('session.messageRow.interrupted', 'Interrupted')}
            </p>
          )}
          {message.errorMessage !== undefined ? <MessageFailure errorMessage={message.errorMessage} /> : null}
          {hasResponseText && (
            <MessageFooter>
              <MessageToolbar session={session} message={message} />
            </MessageFooter>
          )}
        </MessageContent>
      </Message>
    </MessageScrollerItem>
  );
}
