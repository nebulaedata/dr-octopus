/**
 * @author root
 * @description Renders authorized Range-backed video with native controls and codec-failure degradation.
 */

import { useState } from 'react';
import { Maximize2Icon, VideoIcon } from 'lucide-react';
import { Attachment, AttachmentActions, AttachmentMedia } from '@octopus/ui/components/attachment';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@octopus/ui/components/dialog';
import { Button } from '@octopus/ui/components/button';
import {
  MessageAttachmentContent,
  MessageAttachmentDownload,
  MessageAttachmentUnavailableIcon,
} from './message-attachment-parts';
import type { MessageAttachmentDto } from '@octopus/shared/protocol/attachments';

/**
 * Uses native browser decoding without poster generation, autoplay, prefetch, or server transcoding.
 */
export function MessageVideoAttachment({ attachment }: { attachment: MessageAttachmentDto }) {
  const [codecError, setCodecError] = useState(false);
  const playable =
    attachment.availability === 'available' &&
    attachment.capabilities.canPlay &&
    attachment.contentUrl !== undefined &&
    !codecError;
  return (
    <Dialog>
      <Attachment
        state={attachment.availability === 'available' ? 'done' : 'error'}
        size="sm"
        className="ring-0! hover:shadow-lg hover:shadow-black/5 dark:hover:shadow-white/15 transition-shadow duration-200 ease-in-out"
      >
        <AttachmentMedia variant="icon">
          {attachment.availability === 'available' ? <VideoIcon /> : <MessageAttachmentUnavailableIcon />}
        </AttachmentMedia>
        <MessageAttachmentContent attachment={attachment} codecError={codecError} />
        {playable ? (
          <video
            controls
            preload="metadata"
            playsInline
            src={attachment.contentUrl}
            onError={() => setCodecError(true)}
            className="aspect-video w-full rounded-lg"
          />
        ) : null}
        {playable || attachment.capabilities.canDownload ? (
          <AttachmentActions className="w-full gap-2 justify-end">
            {playable && (
              <DialogTrigger
                render={<Button variant="ghost" size="icon-xs" aria-label={`Enlarge ${attachment.name}`} />}
              >
                <Maximize2Icon />
              </DialogTrigger>
            )}
            <MessageAttachmentDownload attachment={attachment} />
          </AttachmentActions>
        ) : null}
      </Attachment>
      {playable ? (
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{attachment.name}</DialogTitle>
            <DialogDescription>{attachment.detectedMediaType}</DialogDescription>
          </DialogHeader>
          <video
            controls
            preload="metadata"
            playsInline
            src={attachment.contentUrl}
            className="max-h-[75vh] w-full"
          />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
