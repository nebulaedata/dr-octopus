/**
 * @author Codex
 * @description Presents compact square image selections with independent removal, processing feedback and gallery preview.
 */

import { useState } from 'react';
import { AlertCircleIcon, ImageIcon, XIcon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import { Spinner } from '@octopus/ui/components/spinner';
import { cn } from '@octopus/ui/lib/utils';
import { HorizontalArea } from '@/components/HorizontalArea';
import { ImagePreviewDialog } from '@/components/ImagePreviewDialog';
import { useObjectUrl } from '@/hooks/use-object-url';
import { useI18n } from '@/i18n/use-i18n';

export interface ImageThumbnailItem {
  id: string;
  name: string;
  src?: string;
  fullSrc?: string;
  blob?: Blob;
  state: 'uploading' | 'processing' | 'ready' | 'failed';
  progress?: number;
  error?: string;
  retryable?: boolean;
  disabled?: boolean;
}

export interface ImageThumbnailListProps {
  images: readonly ImageThumbnailItem[];
  disabled?: boolean;
  /**
   * Removes one selection; resource cleanup belongs to the caller.
   */
  onRemove(id: string): void;
  /**
   * Requeues a caller-declared retryable image.
   */
  onRetry?(id: string): void;
}

/**
 * Keeps the selected image identified by its stable ID while the resource list changes underneath it.
 */
export function ImageThumbnailList({ images, disabled = false, onRemove, onRetry }: ImageThumbnailListProps) {
  const { t } = useI18n();
  const [selectedId, setSelectedId] = useState<string>();
  const selectedIndex = images.findIndex((image) => image.id === selectedId);
  const selected = images[selectedIndex];
  const selectedLocalUrl = useObjectUrl(selected?.blob);
  const previewSrc = selected?.fullSrc ?? selected?.src ?? selectedLocalUrl;
  if (images.length === 0) {
    return null;
  }
  return (
    <>
      <HorizontalArea aria-label="Selected images" className="w-full">
        <div role="list" className="flex w-max gap-3 pt-3 pr-3 pb-3">
          {images.map((image) => (
            <Thumbnail
              key={image.id}
              image={image}
              disabled={disabled}
              onPreview={() => setSelectedId(image.id)}
              onRemove={() => onRemove(image.id)}
              onRetry={onRetry === undefined ? undefined : () => onRetry(image.id)}
            />
          ))}
        </div>
      </HorizontalArea>
      {images
        .filter((image) => image.error !== undefined)
        .map((image) => (
          <p key={image.id} role="alert" className="mb-2 text-xs text-destructive break-words">
            {image.name}: {image.error}
          </p>
        ))}
      <ImagePreviewDialog
        open={selected !== undefined && previewSrc !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedId(undefined);
          }
        }}
        src={previewSrc ?? ''}
        title={selected?.name ?? t('components.imageThumbnails.previewTitle', 'Image preview')}
        gallery={{
          index: selectedIndex,
          count: images.length,
          onPrevious: () => setSelectedId(images[selectedIndex - 1]?.id),
          onNext: () => setSelectedId(images[selectedIndex + 1]?.id),
        }}
      />
    </>
  );
}

/**
 * Owns a transient Blob URL only while this thumbnail is mounted, independently from the preview dialog.
 */
function Thumbnail({
  image,
  disabled,
  onPreview,
  onRemove,
  onRetry,
}: {
  image: ImageThumbnailItem;
  disabled: boolean;
  onPreview(): void;
  onRemove(): void;
  onRetry?: () => void;
}) {
  const { t } = useI18n();
  const localUrl = useObjectUrl(image.blob);
  const src = image.src ?? localUrl;
  const [failedSrc, setFailedSrc] = useState<string>();
  const sourceFailed = src !== undefined && failedSrc === src;
  const busy = image.state === 'uploading' || image.state === 'processing';
  return (
    <div role="listitem" className="relative w-20 shrink-0">
      <button
        type="button"
        aria-label={`Preview ${image.name}`}
        title={image.error ?? image.name}
        disabled={src === undefined}
        onClick={onPreview}
        className={cn(
          'relative flex size-20 cursor-zoom-in items-center justify-center overflow-hidden rounded-xl border bg-muted/40 outline-none focus-visible:ring-2 focus-visible:ring-ring',
          image.state === 'failed' && 'border-destructive'
        )}
      >
        {src && !sourceFailed ? (
          <img
            src={src}
            alt={image.name}
            draggable={false}
            className="size-full object-cover"
            onError={(event) => setFailedSrc(event.currentTarget.currentSrc)}
          />
        ) : (
          <ImageIcon aria-hidden="true" className="size-5 text-muted-foreground" />
        )}
        {busy && (
          <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 bg-background/65 text-xs">
            <Spinner />
            {image.state === 'uploading'
              ? t('components.imageThumbnails.uploading', 'Uploading…')
              : t('components.imageThumbnails.processing', 'Processing…')}
          </span>
        )}
        {(image.state === 'failed' || sourceFailed) && (
          <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-background/90 py-1 text-xs text-destructive">
            <AlertCircleIcon aria-hidden="true" className="size-3" />
            {t('components.imageThumbnails.failed', 'Failed')}
          </span>
        )}
      </button>
      <Button
        type="button"
        variant="destructive"
        size="icon-xs"
        className="absolute -top-3 -right-3 size-8 rounded-full bg-transparent! text-muted-foreground shadow-none transition-colors hover:text-destructive"
        aria-label={`Remove ${image.name}`}
        title={t('components.imageThumbnails.remove', 'Remove image')}
        disabled={disabled || image.disabled === true}
        onClick={onRemove}
      >
        <span className="pointer-events-none flex size-5 items-center justify-center rounded-full border border-border bg-popover shadow-sm transition-colors group-hover/button:bg-muted">
          <XIcon aria-hidden="true" />
        </span>
      </Button>
      {image.retryable && onRetry && (
        <Button variant="link" size="sm" className="h-7 w-full" disabled={disabled} onClick={onRetry}>
          {t('components.imageThumbnails.retry', 'Retry')}
        </Button>
      )}
    </div>
  );
}
