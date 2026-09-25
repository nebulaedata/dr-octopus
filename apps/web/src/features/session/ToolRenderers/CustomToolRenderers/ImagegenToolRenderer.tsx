/**
 * @author Codex
 * @description Displays persisted image outputs using authenticated workspace preview and download routes.
 */
import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { DownloadIcon, ExpandIcon, ImageOffIcon, ChevronDownIcon } from 'lucide-react';
import { buttonVariants } from '@octopus/ui/components/button';
import { useI18n } from '@/i18n/use-i18n';
import { projectImagegen } from '@/features/session/utils/imagegen-projection';
import { ToolContent } from '../ToolRendererParts';
import type { ToolRendererProps } from '../ToolRendererParts';
import type { ImagegenResult } from '@octopus/shared/protocol';

/**
 * Uses the same structured receipt for live events and restored history.
 */
export function ImagegenToolRenderer({ tool }: ToolRendererProps) {
  const { workspaceId } = useParams({ strict: false });
  const result = projectImagegen(tool.details);
  if (!result || !workspaceId || tool.status === 'error') {
    return <ToolContent blocks={tool.content} />;
  }
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {result.images.map((image) => (
        <GeneratedImage key={image.path} image={image} workspaceId={workspaceId} modelId={result.modelId} />
      ))}
    </div>
  );
}

/**
 * Keeps missing-file state local to one historical output and preserves its path.
 */
function GeneratedImage({
  image,
  workspaceId,
  modelId,
}: {
  image: ImagegenResult['images'][number];
  workspaceId: string;
  modelId: string;
}) {
  const { t } = useI18n();
  const [missing, setMissing] = useState(false);
  const base = `/api/workspaces/${encodeURIComponent(workspaceId)}/files`;
  const query = `?path=${encodeURIComponent(image.relativePath)}`;
  return (
    <figure className="flex w-full min-w-0 flex-col overflow-hidden rounded-xl border bg-card">
      {missing ? (
        <div
          role="status"
          className="flex min-h-40 flex-col items-center justify-center gap-3 bg-muted/40 p-6 text-center text-sm text-muted-foreground"
        >
          <ImageOffIcon className="size-6" aria-hidden />
          {t('session.imagegen.missing', 'This image is missing or cannot be previewed.')}
        </div>
      ) : (
        <a
          className="group/image relative block aspect-4/3 w-full overflow-hidden bg-muted/40 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          href={`${base}/image${query}`}
          target="_blank"
          rel="noreferrer"
          aria-label="Open full-size image"
        >
          <img
            src={`${base}/image${query}`}
            alt={t('session.imagegen.alt', 'Generated image')}
            className="absolute inset-0 size-full object-cover transition-opacity duration-300 ease-in-out group-hover/image:opacity-0 group-focus-visible/image:opacity-0 motion-reduce:transition-none"
            width={image.width}
            height={image.height}
            loading="lazy"
            onError={() => setMissing(true)}
          />
          <img
            src={`${base}/image${query}`}
            alt=""
            aria-hidden
            className="pointer-events-none absolute inset-0 size-full object-contain opacity-0 transition-opacity duration-300 ease-in-out group-hover/image:opacity-100 group-focus-visible/image:opacity-100 motion-reduce:transition-none"
            width={image.width}
            height={image.height}
            loading="lazy"
          />
          <span className="absolute right-3 bottom-3 flex items-center gap-1.5 rounded-lg border bg-background/95 px-2.5 py-2 text-xs text-foreground shadow-sm">
            <ExpandIcon className="size-3.5" aria-hidden />
            {t('session.imagegen.viewOriginal', 'View original')}
          </span>
        </a>
      )}
      <figcaption className="flex min-w-0 flex-col gap-3 border-t p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium" title={modelId}>
              {modelId}
            </p>
            <p className="mt-1 text-xs tabular-nums text-muted-foreground">
              {image.width} × {image.height}{' '}
              <span className="px-1" aria-hidden>
                ·
              </span>{' '}
              {image.mimeType.split('/')[1]?.toUpperCase()}
            </p>
          </div>
          {!missing && (
            <a className={buttonVariants({ variant: 'outline' })} href={`${base}/download${query}`} download>
              <DownloadIcon aria-hidden />
              {t('session.imagegen.download', 'Download')}
            </a>
          )}
        </div>
        <details className="group/path min-w-0 text-xs text-muted-foreground">
          <summary className="flex min-h-8 w-fit cursor-pointer list-none items-center gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <ChevronDownIcon className="size-3.5 group-open/path:rotate-180" aria-hidden />
            {t('session.imagegen.filePath', 'File path')}
          </summary>
          <p className="mt-1 select-text break-all rounded-md bg-muted/50 p-2 font-mono">
            {image.relativePath}
          </p>
        </details>
      </figcaption>
    </figure>
  );
}
