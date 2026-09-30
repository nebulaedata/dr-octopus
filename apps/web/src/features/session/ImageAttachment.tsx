/**
 * @author Codex
 * @description 将图片内容块渲染为 shadcn/ui 风格的 Attachment 卡片
 */

import { useState } from 'react';
import { ImagePreviewDialog } from '@/components/ImagePreviewDialog';
import { ImageIcon } from 'lucide-react';
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from '@octopus/ui/components/attachment';
import { useI18n } from '@/i18n/use-i18n';
import type { ContentBlock } from '@/stores/session';
import type { SyntheticEvent } from 'react';

const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

interface ImageAttachmentProps {
  block: Extract<ContentBlock, { type: 'image' }>;
  title?: string;
  preview?: boolean;
}

/**
 * Formats the decoded payload size without allocating a second binary copy of the image.
 */
function imagePayloadSize(data: string): string {
  const encoded = data.replace(/\s/g, '');
  const padding = encoded.length - encoded.replace(/=+$/, '').length;
  const bytes = Math.max(0, Math.floor((encoded.length * 3) / 4) - padding);
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 渲染单张消息图片附件，不支持的类型回退为图标卡片。
 */
export function ImageAttachment({ block, title, preview = false }: ImageAttachmentProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [dimensions, setDimensions] = useState<{ source: string; width: number; height: number }>();
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
  const src = `data:${mimeType};base64,${block.data}`;
  const imageTitle = title ?? t('session.imageAttachment.alt', 'Image attachment');
  const resolution = dimensions?.source === src ? `${dimensions.width} × ${dimensions.height}` : undefined;
  /**
   * Reads decoded dimensions and associates them with this source to avoid stale streaming metadata.
   */
  function handleImageLoad(event: SyntheticEvent<HTMLImageElement>): void {
    const image = event.currentTarget;
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      setDimensions({ source: src, width: image.naturalWidth, height: image.naturalHeight });
    }
  }
  return (
    <>
      {preview ? (
        <Attachment
          size="sm"
          orientation="horizontal"
          className="w-full max-w-md flex-col items-stretch gap-0 overflow-hidden has-data-[slot=attachment-content]:px-0 has-data-[slot=attachment-content]:py-0 has-data-[slot=attachment-media]:p-0"
        >
          <div className="relative">
            <img alt={imageTitle} src={src} onLoad={handleImageLoad} className="block h-auto w-full" />
            <AttachmentTrigger
              aria-label="Preview image"
              title={t('session.imageAttachment.preview', 'Preview image')}
              className="cursor-zoom-in focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              onClick={() => setOpen(true)}
            />
          </div>
          <div className="flex min-w-0 items-center gap-2 border-t p-3">
            <AttachmentMedia variant="icon">
              <ImageIcon aria-hidden />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle title={imageTitle}>{imageTitle}</AttachmentTitle>
              <AttachmentDescription className="flex flex-wrap gap-x-2 gap-y-0.5 whitespace-normal tabular-nums">
                <span>{mimeType.slice('image/'.length).toUpperCase()}</span>
                {resolution ? <span>{resolution}</span> : null}
                <span>{imagePayloadSize(block.data)}</span>
              </AttachmentDescription>
            </AttachmentContent>
          </div>
        </Attachment>
      ) : (
        <Attachment orientation="vertical" className="overflow-hidden has-data-[slot=attachment-media]:p-0">
          <AttachmentMedia variant="image" className="rounded-none">
            <img alt={imageTitle} src={src} />
          </AttachmentMedia>
          <AttachmentTrigger
            aria-label="Preview image"
            title={t('session.imageAttachment.preview', 'Preview image')}
            className="cursor-zoom-in"
            onClick={() => setOpen(true)}
          />
        </Attachment>
      )}
      <ImagePreviewDialog open={open} onOpenChange={setOpen} src={src} title={imageTitle} />
    </>
  );
}
