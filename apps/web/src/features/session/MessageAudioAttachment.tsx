/**
 * @author root
 * @description Renders authorized Range-backed audio without autoplay, transcription, or Agent-content claims.
 */

import { useState } from 'react';
import { AudioLinesIcon } from 'lucide-react';
import { Attachment, AttachmentActions, AttachmentMedia } from '@octopus/ui/components/attachment';
import {
  MessageAttachmentContent,
  MessageAttachmentDownload,
  MessageAttachmentUnavailableIcon,
} from './message-attachment-parts';
import type { MessageAttachmentDto } from '@octopus/shared/protocol/attachments';

/**
 * Uses native metadata-only loading and degrades to a downloadable file card on codec failure.
 */
export function MessageAudioAttachment({ attachment }: { attachment: MessageAttachmentDto }) {
  const [codecError, setCodecError] = useState(false);
  const playable =
    attachment.availability === 'available' &&
    attachment.capabilities.canPlay &&
    attachment.contentUrl !== undefined &&
    !codecError;
  return (
    <Attachment
      state={attachment.availability === 'available' ? 'done' : 'error'}
      size="sm"
      className="ring-0! hover:shadow-lg hover:shadow-black/5 dark:hover:shadow-white/15 transition-shadow duration-200 ease-in-out"
    >
      <AttachmentMedia variant="icon">
        {attachment.availability === 'available' ? <AudioLinesIcon /> : <MessageAttachmentUnavailableIcon />}
      </AttachmentMedia>
      <MessageAttachmentContent attachment={attachment} codecError={codecError} />
      {playable ? (
        <audio
          controls
          preload="metadata"
          src={attachment.contentUrl}
          onError={() => setCodecError(true)}
          className="w-full"
        />
      ) : null}
      {attachment.capabilities.canDownload ? (
        <AttachmentActions className="w-full gap-2 justify-end">
          <MessageAttachmentDownload attachment={attachment} />
        </AttachmentActions>
      ) : null}
    </Attachment>
  );
}
