/**
 * @author root
 * @description Provides shared feature-level attachment metadata, availability, and authorized download composition.
 */

import { AttachmentDiagnostics } from './AttachmentDiagnostics';
import { documentCoverageLabel } from './document-coverage-label';
import { DownloadIcon, FileWarningIcon } from 'lucide-react';
import {
  AttachmentAction,
  AttachmentContent,
  AttachmentDescription,
  AttachmentTitle,
} from '@octopus/ui/components/attachment';
import { useI18n } from '@/i18n/use-i18n';
import type { MessageAttachmentDto } from '@octopus/shared/protocol/attachments';
import type { Translate } from '@/i18n/use-i18n';

/**
 * Renders stable name, size, media type, and unavailable/deleted wording.
 */
export function MessageAttachmentContent({
  attachment,
  codecError = false,
}: {
  attachment: MessageAttachmentDto;
  codecError?: boolean;
}) {
  const { t } = useI18n();
  const diagnosis =
    attachment.availability === 'available' && !codecError
      ? documentCoverageLabel(t, attachment.coverage)
      : undefined;
  return (
    <AttachmentContent>
      <AttachmentTitle>{attachment.name}</AttachmentTitle>
      <AttachmentDescription>
        {diagnosis ? (
          <>
            <AttachmentDiagnostics text={diagnosis} /> · {formatBytes(attachment.byteSize)}
          </>
        ) : (
          availabilityText(t, attachment, codecError)
        )}
      </AttachmentDescription>
    </AttachmentContent>
  );
}
/**
 * Renders an authorized download action for composition inside a card action group.
 */
export function MessageAttachmentDownload({ attachment }: { attachment: MessageAttachmentDto }) {
  const { t } = useI18n();
  if (
    !attachment.capabilities.canDownload ||
    attachment.contentUrl === undefined ||
    attachment.availability !== 'available'
  ) {
    return null;
  }
  const contentUrl = attachment.contentUrl;
  return (
    <AttachmentAction
      aria-label={`Download ${attachment.name}`}
      title={t('session.attachments.downloadTitle', 'Download')}
      onClick={() => downloadAttachment(contentUrl, attachment.name)}
    >
      <DownloadIcon />
    </AttachmentAction>
  );
}

/**
 * Starts a same-origin authorized attachment download from an explicit button action.
 *
 * @param contentUrl - Host-authorized attachment content endpoint.
 * @param name - Verified download filename.
 */
function downloadAttachment(contentUrl: string, name: string): void {
  const link = document.createElement('a');
  link.href = `${contentUrl}?disposition=attachment`;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
}
/**
 * Provides a common unavailable icon without changing the card renderer family.
 */
export function MessageAttachmentUnavailableIcon() {
  return <FileWarningIcon />;
}
/**
 * Formats bytes and immutable availability state in the active locale.
 */
function availabilityText(
  t: Translate,
  attachment: MessageAttachmentDto,
  codecError: boolean
): string {
  if (attachment.availability === 'deleted') {
    return t('session.attachments.deleted', 'Deleted attachment');
  }
  if (attachment.availability === 'unavailable') {
    return t('session.attachments.unavailable', 'Temporarily unavailable');
  }
  if (codecError) {
    return t('session.attachments.codecUnsupported', 'This browser cannot play the verified media codec');
  }
  return `${attachment.detectedMediaType} · ${formatBytes(attachment.byteSize)}`;
}
/**
 * Formats bounded file sizes.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1_024) {
    return `${String(bytes)} B`;
  }
  if (bytes < 1_048_576) {
    return `${(bytes / 1_024).toFixed(1)} KiB`;
  }
  return `${(bytes / 1_048_576).toFixed(1)} MiB`;
}
