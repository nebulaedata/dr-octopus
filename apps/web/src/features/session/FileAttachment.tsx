/**
 * @author Codex
 * @description 将文件内容块渲染为可下载的 shadcn/ui Attachment 卡片
 */

import { DownloadIcon, FileTextIcon } from 'lucide-react';
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from '@octopus/ui/components/attachment';
import { download } from '@/utils/common';
import { useI18n } from '@/i18n/use-i18n';
import type { ContentBlock } from '@/stores/session';

interface FileAttachmentProps {
  block: Extract<ContentBlock, { type: 'file' }>;
}

/**
 * 将字节数格式化为人类可读大小。
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

/**
 * 渲染文件附件卡片并提供 base64 下载。
 */
export function FileAttachment({ block }: FileAttachmentProps) {
  const { t } = useI18n();
  /**
   * Downloads the attachment's base64 payload with its display name.
   */
  function handleDownload(): void {
    download(`data:${block.mimeType};base64,${block.data}`, block.name || 'download');
  }

  const description = [block.mimeType, formatBytes(block.size)].filter(Boolean).join(' · ');

  return (
    <Attachment orientation="horizontal">
      <AttachmentMedia variant="icon">
        <FileTextIcon />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{block.name || t('session.attachments.untitled', 'Untitled attachment')}</AttachmentTitle>
        {description ? <AttachmentDescription>{description}</AttachmentDescription> : null}
      </AttachmentContent>
      <AttachmentActions>
        <AttachmentAction
          aria-label="Download file"
          title={t('session.attachments.downloadTitle', 'Download')}
          size="icon-sm"
          variant="secondary"
          onClick={handleDownload}
        >
          <DownloadIcon />
        </AttachmentAction>
      </AttachmentActions>
    </Attachment>
  );
}
