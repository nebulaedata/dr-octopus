/**
 * @author root
 * @description Dispatches stable Conversation attachment DTOs exclusively by the Host-owned presentationKind.
 */

import { AttachmentGroup } from '@octopus/ui/components/attachment';
import { HorizontalArea } from '@/components/HorizontalArea';
import { MessageAudioAttachment } from './MessageAudioAttachment';
import { MessageFileAttachment } from './MessageFileAttachment';
import { MessageImageAttachment } from './MessageImageAttachment';
import { MessageVideoAttachment } from './MessageVideoAttachment';
import type { MessageAttachmentDto } from '@octopus/shared/protocol/attachments';

/**
 * Renders an ordered attachment row without extension or MIME based renderer guesses.
 */
export function MessageAttachmentGroup({ attachments }: { attachments: MessageAttachmentDto[] }) {
  return (
    <HorizontalArea aria-label="Message attachments" fit className="self-end">
      <AttachmentGroup className="w-max flex-nowrap items-start overflow-visible pb-3 *:data-[slot=attachment]:w-72 *:data-[slot=attachment]:max-w-full">
        {attachments.map((attachment) => {
          if (attachment.presentationKind === 'image') {
            return <MessageImageAttachment key={attachment.id} attachment={attachment} />;
          }
          if (attachment.presentationKind === 'audio') {
            return <MessageAudioAttachment key={attachment.id} attachment={attachment} />;
          }
          if (attachment.presentationKind === 'video') {
            return <MessageVideoAttachment key={attachment.id} attachment={attachment} />;
          }
          return <MessageFileAttachment key={attachment.id} attachment={attachment} />;
        })}
      </AttachmentGroup>
    </HorizontalArea>
  );
}
