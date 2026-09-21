/**
 * @author root
 * @description Renders an authorized image derivative card with a keyboard-accessible shadcn Dialog preview.
 */

import { EyeIcon, ImageIcon } from 'lucide-react';
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentMedia,
} from '@octopus/ui/components/attachment';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@octopus/ui/components/dialog';
import {
  MessageAttachmentContent,
  MessageAttachmentDownload,
  MessageAttachmentUnavailableIcon,
} from './message-attachment-parts';
import { useI18n } from '@/i18n/use-i18n';
import type { MessageAttachmentDto } from '@octopus/shared/protocol/attachments';

/**
 * Renders only Host-provided preview URLs and never an extension-derived image source.
 */
export function MessageImageAttachment({ attachment }: { attachment: MessageAttachmentDto }) {
  const { t } = useI18n();
  const available = attachment.availability === 'available' && attachment.previewUrl !== undefined;
  return (
    <Dialog>
      <Attachment
        state={available ? 'done' : 'error'}
        size="sm"
        className="h-16 ring-0! hover:shadow-lg hover:shadow-black/5 dark:hover:shadow-white/15 transition-shadow duration-200 ease-in-out"
      >
        <AttachmentMedia variant={available ? 'image' : 'icon'}>
          {available ? (
            <img src={attachment.previewUrl} alt="" loading="lazy" />
          ) : attachment.availability === 'available' ? (
            <ImageIcon />
          ) : (
            <MessageAttachmentUnavailableIcon />
          )}
        </AttachmentMedia>
        <MessageAttachmentContent attachment={attachment} />
        {available || attachment.capabilities.canDownload ? (
          <AttachmentActions>
            {available ? (
              <DialogTrigger
                render={
                  <AttachmentAction
                    aria-label={`Preview ${attachment.name}`}
                    title={t('session.attachments.previewTitle', 'Preview')}
                  />
                }
              >
                <EyeIcon />
              </DialogTrigger>
            ) : null}
            <MessageAttachmentDownload attachment={attachment} />
          </AttachmentActions>
        ) : null}
      </Attachment>
      {available ? (
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{attachment.name}</DialogTitle>
            <DialogDescription>{attachment.detectedMediaType}</DialogDescription>
          </DialogHeader>
          <img
            src={attachment.contentUrl ?? attachment.previewUrl}
            alt={attachment.name}
            className="max-h-[75vh] max-w-full object-contain"
          />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
