/**
 * @author Codex
 * @description 将图片内容块渲染为 shadcn/ui 风格的 Attachment 卡片
 */

import { ImageIcon } from 'lucide-react';
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from '@octopus/ui/components/attachment';
import { useI18n } from '@/i18n/use-i18n';
import type { ContentBlock } from '@/stores/session';

const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

interface ImageAttachmentProps {
  block: Extract<ContentBlock, { type: 'image' }>;
  title?: string;
}

/**
 * 渲染单张消息图片附件，不支持的类型回退为图标卡片。
 */
export function ImageAttachment({ block, title }: ImageAttachmentProps) {
  const { t } = useI18n();
  const mimeType = block.mimeType ?? 'image/png';
  if (!SUPPORTED_IMAGE_TYPES.includes(mimeType)) {
    return (
      <Attachment orientation="horizontal">
        <AttachmentMedia variant="icon">
          <ImageIcon />
        </AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle>
            {t('session.imageAttachment.unsupported', 'Unsupported attachment')}
          </AttachmentTitle>
          <AttachmentDescription>{mimeType}</AttachmentDescription>
        </AttachmentContent>
      </Attachment>
    );
  }
  return (
    <Attachment orientation="vertical">
      <AttachmentMedia variant="image">
        <img
          alt={title ?? t('session.imageAttachment.alt', 'Image attachment')}
          src={`data:${mimeType};base64,${block.data}`}
        />
      </AttachmentMedia>
    </Attachment>
  );
}
