/**
 * @author Codex
 * @description Renders the same message presentation for startup receipts and authoritative transcript entries.
 */
import { Bubble, BubbleContent } from '@octopus/ui/components/bubble';
import { Message, MessageContent, MessageFooter, MessageHeader } from '@octopus/ui/components/message';
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
 * Keeps message colors, Markdown, attachments and actions independent of the source of its content.
 */
export function MessageView({
  session,
  message,
  isStreaming = false,
}: {
  session: SessionDto;
  message: MessageProjection;
  isStreaming?: boolean;
}) {
  const { t } = useI18n();
  const memorySave = projectMemorySave(message);
  if (memorySave !== undefined) {
    return (
      <Message align="start">
        <MessageContent className="p-1">
          <MemorySaveCard receipt={memorySave} timestamp={message.timestamp ?? message.persistedAt} />
        </MessageContent>
      </Message>
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
    <Message align={isUserRole ? 'end' : 'start'}>
      <MessageContent>
        <MessageHeader>
          <div className="flex items-center gap-2">
            {isUserRole && (
              <span className="text-[11px]">{message.timestamp && formatMessageTime(message.timestamp)}</span>
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
  );
}
