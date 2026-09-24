/**
 * @author root
 * @description Renders a generic verified file attachment with capability-gated authorized download and tombstone states.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EyeIcon, FileTextIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@octopus/ui/components/alert';
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
import { Spinner } from '@octopus/ui/components/spinner';
import { Separator } from '@octopus/ui/components/separator';
import { getAttachmentPreviewContent } from '@/api/attachments';
import { CodeEditor } from '@/components/CodeEditor';
import { FileContentPreview } from '@/components/FileContentPreview';
import { useI18n } from '@/i18n/use-i18n';
import {
  MessageAttachmentContent,
  MessageAttachmentDownload,
  MessageAttachmentUnavailableIcon,
} from './message-attachment-parts';
import type { MessageAttachmentDto } from '@octopus/shared/protocol/attachments';

/**
 * Keeps ordinary files and deleted resources in the shared Attachment shell.
 */
export function MessageFileAttachment({ attachment }: { attachment: MessageAttachmentDto }) {
  const { t } = useI18n();
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewable =
    attachment.availability === 'available' &&
    attachment.capabilities.canPreview &&
    (attachment.previewKind === 'markdown' ||
      (attachment.previewKind === 'code' && attachment.previewLanguage !== undefined)) &&
    attachment.contentUrl !== undefined;
  const preview = useQuery({
    queryKey: ['attachment-text-preview', attachment.id],
    queryFn: ({ signal }) => getAttachmentPreviewContent(attachment.contentUrl ?? '', signal),
    enabled: previewOpen && previewable,
    staleTime: Number.POSITIVE_INFINITY,
  });
  /**
   * Selects dialog content content in the existing condition order.
   */
  function renderPreviewContent() {
    if (preview.isPending) {
      return (
        <div className="flex min-h-0 items-center justify-center gap-2 text-muted-foreground">
          <Spinner />
          {t('session.messageFile.loadingPreview', 'Loading preview…')}
        </div>
      );
    } else if (preview.isError) {
      return (
        <Alert variant="destructive">
          <AlertTitle>{t('session.messageFile.previewFailed', 'Unable to open preview')}</AlertTitle>
          <AlertDescription>{preview.error.message}</AlertDescription>
        </Alert>
      );
    } else {
      return (
        <div className="min-h-0 overflow-hidden">
          {attachment.previewKind === 'code' && attachment.previewLanguage !== undefined ? (
            <CodeEditor readOnly language={attachment.previewLanguage} value={preview.data} />
          ) : (
            <FileContentPreview kind="markdown">{preview.data}</FileContentPreview>
          )}
        </div>
      );
    }
  }
  return (
    <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
      <Attachment
        state={attachment.availability === 'available' ? 'done' : 'error'}
        size="sm"
        className="h-16 ring-0! hover:shadow-lg hover:shadow-black/5 dark:hover:shadow-white/15 transition-shadow duration-200 ease-in-out"
      >
        <AttachmentMedia variant="icon">
          {attachment.availability === 'available' ? <FileTextIcon /> : <MessageAttachmentUnavailableIcon />}
        </AttachmentMedia>
        <MessageAttachmentContent attachment={attachment} />
        {previewable || attachment.capabilities.canDownload ? (
          <AttachmentActions>
            {previewable ? (
              <DialogTrigger
                render={
                  <AttachmentAction
                    aria-label={`Preview ${attachment.name}`}
                    title={t('session.messageFile.preview', 'Preview')}
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
      {previewable ? (
        <DialogContent className="h-[min(85vh,900px)] grid-rows-[auto_auto_minmax(0,1fr)] sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle className="truncate">{attachment.name}</DialogTitle>
            <DialogDescription>{attachment.detectedMediaType}</DialogDescription>
          </DialogHeader>
          <Separator />
          {renderPreviewContent()}
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
