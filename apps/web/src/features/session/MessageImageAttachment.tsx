/**
 * @author root
 * @description Renders an authorized image derivative card with a keyboard-accessible shadcn Dialog preview.
 */

import { useState } from 'react';
import { EyeIcon, ImageIcon } from 'lucide-react';
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentMedia,
} from '@octopus/ui/components/attachment';
import { ImagePreviewDialog } from '@/components/ImagePreviewDialog';
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
  const [previewOpen, setPreviewOpen] = useState(false);
  const available = attachment.availability === 'available' && attachment.previewUrl !== undefined;
  /**
   * Selects attachment media content in the existing condition order.
   */
  function renderAttachmentMediaContent() {
    if (available) {
      return <img src={attachment.previewUrl} alt="" loading="lazy" />;
    } else if (attachment.availability === 'available') {
      return <ImageIcon />;
    } else {
      return <MessageAttachmentUnavailableIcon />;
    }
  }
  return (
    <>
      <Attachment
        state={available ? 'done' : 'error'}
        size="sm"
        className="h-16 ring-0! hover:shadow-lg hover:shadow-black/5 dark:hover:shadow-white/15 transition-shadow duration-200 ease-in-out"
      >
        <AttachmentMedia variant={available ? 'image' : 'icon'}>
          {renderAttachmentMediaContent()}
        </AttachmentMedia>
        <MessageAttachmentContent attachment={attachment} />
        {available || attachment.capabilities.canDownload ? (
          <AttachmentActions>
            {available ? (
              <AttachmentAction
                aria-label={`Preview ${attachment.name}`}
                title={t('session.attachments.previewTitle', 'Preview')}
                onClick={() => setPreviewOpen(true)}
              >
                <EyeIcon />
              </AttachmentAction>
            ) : null}
            <MessageAttachmentDownload attachment={attachment} />
          </AttachmentActions>
        ) : null}
      </Attachment>
      {available ? (
        <ImagePreviewDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          src={attachment.contentUrl ?? attachment.previewUrl ?? ''}
          title={attachment.name}
          description={attachment.detectedMediaType}
        />
      ) : null}
    </>
  );
}
