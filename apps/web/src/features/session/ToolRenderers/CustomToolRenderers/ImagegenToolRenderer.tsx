/**
 * @author Codex
 * @description Displays persisted image outputs using authenticated workspace preview and download routes.
 */
import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { DownloadIcon, ImageOffIcon, ChevronRightIcon } from 'lucide-react';
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
    <figure className="flex w-full min-w-0 max-w-md flex-col overflow-hidden rounded-xl border bg-card">
      {missing ? (
        <div
          role="status"
          className="flex h-56 shrink-0 flex-col items-center justify-center gap-3 bg-muted/40 p-6 text-center text-xs text-muted-foreground"
        >
          <ImageOffIcon className="size-6" aria-hidden />
          {t('session.imagegen.missing', 'This image is missing or cannot be previewed.')}
        </div>
      ) : (
        <a
          className="relative block w-full shrink-0 cursor-zoom-in overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          href={`${base}/image${query}`}
          target="_blank"
          rel="noreferrer"
          aria-label="Open full-size image"
        >
          <img
            src={`${base}/image${query}`}
            alt={t('session.imagegen.alt', 'Generated image')}
            className="block h-auto w-full"
            width={image.width}
            height={image.height}
            loading="lazy"
            onError={() => setMissing(true)}
          />
        </a>
      )}
      <figcaption className="flex min-w-0 flex-col gap-2 border-t px-3 py-2">
        <div className="flex items-center justify-between gap-2">
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
            <a
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
              href={`${base}/download${query}`}
              download
            >
              <DownloadIcon aria-hidden />
              {t('session.imagegen.download', 'Download')}
            </a>
          )}
        </div>
        <details className="group/path min-w-0 text-xs text-muted-foreground">
          <summary className="flex min-h-8 w-fit cursor-pointer list-none items-center gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon className="size-3.5 group-open/path:rotate-90" aria-hidden />
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
