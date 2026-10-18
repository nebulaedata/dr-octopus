/**
 * @author Codex
 * @description Displays an image in a reusable Dialog with zoom and rotation controls.
 */

import { useEffect, useRef, useState } from 'react';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  RotateCcwIcon,
  RotateCwIcon,
  ScanIcon,
  ZoomInIcon,
  ZoomOutIcon,
  RefreshCwIcon,
} from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@octopus/ui/components/dialog';
import { Spinner } from '@octopus/ui/components/spinner';
import { cn } from '@octopus/ui/lib/utils';
import { useI18n } from '@/i18n/use-i18n';
import type { PointerEvent } from 'react';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

interface PanPosition {
  x: number;
  y: number;
}

/**
 * Constrains panning to the part of a scaled, possibly rotated image outside its viewport.
 */
function clampPan(
  position: PanPosition,
  zoom: number,
  rotation: number,
  viewport: HTMLDivElement | null,
  image: HTMLImageElement | null
): PanPosition {
  if (viewport === null || image === null) {
    return { x: 0, y: 0 };
  }
  const quarterTurn = Math.abs(rotation / 90) % 2 === 1;
  const width = (quarterTurn ? image.offsetHeight : image.offsetWidth) * zoom;
  const height = (quarterTurn ? image.offsetWidth : image.offsetHeight) * zoom;
  const maxX = Math.max(0, (width - viewport.clientWidth) / 2);
  const maxY = Math.max(0, (height - viewport.clientHeight) / 2);
  return {
    x: Math.max(-maxX, Math.min(maxX, position.x)),
    y: Math.max(-maxY, Math.min(maxY, position.y)),
  };
}

/**
 * Shares viewer appearance across the site. All optional capability flags default to true.
 * Gallery indices are zero-based; the caller owns image sources, ordering and selection.
 */
export interface ImagePreviewDialogProps {
  open: boolean;
  /**
   * Reports dismissal through the close button, Escape, or an enabled overlay click.
   */
  onOpenChange(open: boolean): void;
  src: string;
  title: string;
  description?: string;
  /**
   * Enables gallery buttons and arrow keys; single-image galleries always hide navigation.
   */
  navigation?: boolean;
  counter?: boolean;
  zoomable?: boolean;
  rotatable?: boolean;
  pannable?: boolean;
  showInfo?: boolean;
  closeOnOverlayClick?: boolean;
  gallery?: {
    index: number;
    count: number;
    /**
     * Selects the preceding image; disabled at the start of the gallery.
     */
    onPrevious(): void;
    /**
     * Selects the following image; disabled at the end of the gallery.
     */
    onNext(): void;
  };
}

/**
 * Keeps the Dialog's focus and dismissal behavior while resetting the viewer each time it opens.
 */
export function ImagePreviewDialog({
  open,
  onOpenChange,
  src,
  title,
  description,
  navigation,
  closeOnOverlayClick = true,
  ...options
}: ImagePreviewDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (!closeOnOverlayClick && details.reason === 'outside-press') {
          details.cancel();
          return;
        }
        onOpenChange(nextOpen);
      }}
    >
      {open && (
        <ImagePreviewContent
          key={`${options.gallery?.index ?? 0}:${src}`}
          src={src}
          title={title}
          description={description}
          navigation={navigation}
          {...options}
        />
      )}
    </Dialog>
  );
}

/**
 * Owns presentation state for one image and clamps every zoom input to a usable range.
 */
function ImagePreviewContent({
  src,
  title,
  description,
  navigation = true,
  counter = true,
  zoomable = true,
  rotatable = true,
  pannable = true,
  showInfo = true,
  gallery,
}: Omit<ImagePreviewDialogProps, 'open' | 'onOpenChange' | 'closeOnOverlayClick'>) {
  const { t } = useI18n();
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState<PanPosition>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const multiple = gallery !== undefined && gallery.count > 1;
  const canNavigate = navigation && multiple;
  const showCounter = counter && multiple;
  const showTools = zoomable || rotatable;
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    pan: PanPosition;
  } | null>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) {
      return;
    }
    const constrain = () => {
      setPan((current) => {
        const next = clampPan(current, zoom, rotation, viewport, imageRef.current);
        return next.x === current.x && next.y === current.y ? current : next;
      });
    };
    constrain();
    const observer = new ResizeObserver(constrain);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [zoom, rotation, loadState]);

  /**
   * Changes zoom in fixed steps for buttons and mouse wheels, respecting the shared limits.
   */
  function changeZoom(direction: -1 | 1) {
    setZoom((current) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current + direction * ZOOM_STEP)));
  }

  /**
   * Captures a pointer so an enlarged image keeps following the drag outside its viewport.
   */
  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (
      !pannable ||
      loadState !== 'loaded' ||
      zoom <= 1 ||
      (event.pointerType === 'mouse' && event.button !== 0)
    ) {
      return;
    }
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      pan,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDragging(true);
    event.preventDefault();
  }

  /**
   * Moves the image in viewport coordinates without letting empty space replace its visible edges.
   */
  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }
    setPan(
      clampPan(
        {
          x: drag.pan.x + event.clientX - drag.startX,
          y: drag.pan.y + event.clientY - drag.startY,
        },
        zoom,
        rotation,
        viewportRef.current,
        imageRef.current
      )
    );
  }

  /**
   * Ends a drag on release or cancellation and clears its pointer capture.
   */
  function handlePointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <DialogContent
      className="grid h-[min(90dvh,920px)] grid-rows-[auto_minmax(0,1fr)_auto] gap-3 overflow-hidden p-3 sm:max-w-6xl sm:p-4"
      onKeyDown={(event) => {
        if (!canNavigate || !gallery || event.altKey || event.ctrlKey || event.metaKey) {
          return;
        }
        if (event.key === 'ArrowLeft' && gallery.index > 0) {
          event.preventDefault();
          gallery.onPrevious();
        } else if (event.key === 'ArrowRight' && gallery.index + 1 < gallery.count) {
          event.preventDefault();
          gallery.onNext();
        }
      }}
    >
      <DialogHeader className={cn('min-w-0 pr-9', !showInfo && 'sr-only')}>
        <DialogTitle className="truncate" title={title}>
          {title}
        </DialogTitle>
        <DialogDescription className="truncate" title={description}>
          {description ??
            (zoomable
              ? t('components.imagePreview.hint', 'Use the mouse wheel or controls to zoom.')
              : title)}
        </DialogDescription>
      </DialogHeader>

      <div
        ref={viewportRef}
        className={cn(
          'relative row-start-2 flex min-h-0 items-center justify-center overflow-hidden overscroll-contain rounded-xl border border-border bg-muted/40',
          pannable && zoom > 1 && (isDragging ? 'cursor-grabbing touch-none' : 'cursor-grab touch-none')
        )}
        style={{ containerType: 'size' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onLostPointerCapture={handlePointerEnd}
        onWheel={(event) => {
          if (zoomable && loadState === 'loaded' && event.deltaY !== 0) {
            changeZoom(event.deltaY < 0 ? 1 : -1);
          }
        }}
      >
        {loadState === 'loading' && <Spinner className="absolute size-5 text-muted-foreground" />}
        {loadState === 'error' && (
          <div role="alert" className="flex flex-col items-center gap-3 px-4 text-center">
            <p className="text-sm text-destructive">
              {t('components.imagePreview.loadFailed', 'Unable to load image.')}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLoadState('loading');
                setAttempt((current) => current + 1);
              }}
            >
              <RefreshCwIcon data-icon="inline-start" />
              {t('common.retry', 'Retry')}
            </Button>
          </div>
        )}
        {pannable && loadState === 'loaded' && zoom > 1 && (
          <span className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-background/85 px-2 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur-sm">
            {t('components.imagePreview.dragHint', 'Drag to move')}
          </span>
        )}
        <img
          key={attempt}
          ref={imageRef}
          src={src}
          alt={title}
          draggable={false}
          className={cn(
            'max-h-full max-w-full select-none object-contain',
            !isDragging && 'motion-safe:transition-transform motion-safe:duration-150'
          )}
          style={{
            // Swapping the available axes keeps quarter-turned images fitted at 100% zoom.
            maxWidth: rotation % 180 === 0 ? '100%' : '100cqh',
            maxHeight: rotation % 180 === 0 ? '100%' : '100cqw',
            transform: `translate(${pan.x}px, ${pan.y}px) rotate(${rotation}deg) scale(${zoom})`,
            opacity: loadState === 'loaded' ? 1 : 0,
          }}
          onLoad={() => setLoadState('loaded')}
          onError={() => setLoadState('error')}
        />
      </div>

      {(showTools || canNavigate || showCounter) && (
        <div className="row-start-3 grid grid-cols-[1fr_auto_1fr] items-center gap-y-2">
          <div className="col-start-1 row-start-1 justify-self-start">
            {canNavigate && gallery && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Previous image"
                disabled={gallery.index <= 0}
                onClick={gallery.onPrevious}
              >
                <ChevronLeftIcon />
              </Button>
            )}
          </div>
          <div className="col-start-3 row-start-1 flex items-center gap-2 justify-self-end">
            {showCounter && gallery && (
              <span
                className="whitespace-nowrap text-xs text-muted-foreground tabular-nums"
                aria-live="polite"
              >{`${gallery.index + 1} / ${gallery.count}`}</span>
            )}
            {canNavigate && gallery && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Next image"
                disabled={gallery.index + 1 >= gallery.count}
                onClick={gallery.onNext}
              >
                <ChevronRightIcon />
              </Button>
            )}
          </div>
          {showTools && (
            <div
              className={cn(
                'col-span-3 row-start-2 flex min-w-0 flex-wrap items-center justify-center gap-1 justify-self-center rounded-xl border border-border bg-background p-1 sm:col-span-1 sm:col-start-2 sm:row-start-1',
                !canNavigate && !showCounter && 'row-start-1'
              )}
            >
              {zoomable && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Zoom out"
                    title={t('components.imagePreview.zoomOut', 'Zoom out')}
                    disabled={loadState !== 'loaded' || zoom <= MIN_ZOOM}
                    onClick={() => changeZoom(-1)}
                  >
                    <ZoomOutIcon />
                  </Button>
                  <span className="min-w-14 text-center text-xs font-medium tabular-nums" aria-live="polite">
                    {Math.round(zoom * 100)}%
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Zoom in"
                    title={t('components.imagePreview.zoomIn', 'Zoom in')}
                    disabled={loadState !== 'loaded' || zoom >= MAX_ZOOM}
                    onClick={() => changeZoom(1)}
                  >
                    <ZoomInIcon />
                  </Button>
                </>
              )}
              {zoomable && rotatable && <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />}
              {rotatable && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Rotate left"
                    title={t('components.imagePreview.rotateLeft', 'Rotate left')}
                    disabled={loadState !== 'loaded'}
                    onClick={() => setRotation((current) => current - 90)}
                  >
                    <RotateCcwIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Rotate right"
                    title={t('components.imagePreview.rotateRight', 'Rotate right')}
                    disabled={loadState !== 'loaded'}
                    onClick={() => setRotation((current) => current + 90)}
                  >
                    <RotateCwIcon />
                  </Button>
                </>
              )}
              <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Reset image view"
                title={t('components.imagePreview.reset', 'Reset view')}
                disabled={loadState !== 'loaded' || (zoom === 1 && rotation === 0)}
                onClick={() => {
                  setZoom(1);
                  setRotation(0);
                  setPan({ x: 0, y: 0 });
                }}
              >
                <ScanIcon />
              </Button>
            </div>
          )}
        </div>
      )}
    </DialogContent>
  );
}
