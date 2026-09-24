/**
 * @author Codex
 * @description Presents knowledge discovery, retrieval and citation reading as theme-aware source cards inside ordinary Sessions.
 */
import { BookOpenIcon, LibraryBigIcon, SearchIcon, SearchXIcon } from 'lucide-react';
import { cn } from '@octopus/ui/lib/utils';
import { Badge } from '@octopus/ui/components/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@octopus/ui/components/card';
import { Alert, AlertDescription, AlertTitle } from '@octopus/ui/components/alert';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@octopus/ui/components/empty';
import { Skeleton } from '@octopus/ui/components/skeleton';
import { useI18n } from '@/i18n/use-i18n';
import { ToolContent } from '../ToolRendererParts';
import { isRecord, readString } from '@/features/session/utils/tool-renderer-utils';
import { KnowledgeEvidenceCard } from './KnowledgeEvidenceCard';
import { projectKnowledgeEvidence } from '@/features/session/utils/knowledge-projection';
import type { ToolRendererProps } from '../ToolRendererParts';

/**
 * Read structured snapshots only; errors and unknown result shapes retain the existing text/image fallback.
 */
export function KnowledgeToolRenderer({ tool }: ToolRendererProps) {
  const { t } = useI18n();
  const data = isRecord(tool.details) ? tool.details : undefined;
  if (tool.status === 'error') {
    return <ToolContent blocks={tool.content} />;
  }
  if (!data && tool.status === 'running' && !tool.content.length) {
    return <KnowledgeLoading />;
  }
  if (
    tool.name === 'knowledge_list_collections' &&
    Array.isArray(data?.items) &&
    data.items.every((item) => isRecord(item) && typeof item.name === 'string')
  ) {
    return <KnowledgeCollections items={data.items} total={data.total} />;
  }
  if (tool.name === 'knowledge_read') {
    const evidence = projectKnowledgeEvidence(t, data, readString(tool.arguments, 'citationId'));
    if (evidence) {
      return <KnowledgeEvidenceCard evidence={evidence} expanded />;
    }
  }
  if (tool.name !== 'knowledge_search' || !Array.isArray(data?.hits)) {
    return <ToolContent blocks={tool.content} />;
  }
  const hits = data.hits.slice(0, 20).map((hit: unknown) => projectKnowledgeEvidence(t, hit));
  if (hits.some((hit) => !hit)) {
    return <ToolContent blocks={tool.content} />;
  }
  const query = readString(tool.arguments, 'query')?.slice(0, 2000);
  return (
    <div className="@container flex min-w-0 flex-col gap-4">
      <KnowledgeHeading
        title={t('session.knowledgeTool.searchTitle', 'Knowledge search')}
        description={t(
          'session.knowledgeTool.searchDescription',
          'Material fragments related to this question'
        )}
        count={t('session.knowledgeTool.evidenceCount', '{{count}} pieces of evidence', {
          count: hits.length,
        })}
      />
      {query && (
        <div className="flex min-w-0 items-start gap-2 rounded-lg bg-muted/50 px-3 py-2.5">
          <SearchIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="line-clamp-3 wrap-anywhere text-xs leading-5 text-muted-foreground" title={query}>
            {query}
          </p>
        </div>
      )}
      {(data.coverage === 'partial' || data.coverage === 'unavailable') && (
        <Alert>
          <SearchXIcon />
          <AlertTitle>
            {data.coverage === 'unavailable'
              ? t('session.knowledgeTool.coverageUnavailableTitle', 'Unable to search materials right now')
              : t('session.knowledgeTool.coveragePartialTitle', 'Some sources temporarily unavailable')}
          </AlertTitle>
          <AlertDescription>
            {data.coverage === 'unavailable'
              ? t(
                  'session.knowledgeTool.coverageUnavailableDescription',
                  'Knowledge sources are temporarily inaccessible. Please try again later.'
                )
              : t(
                  'session.knowledgeTool.coveragePartialDescription',
                  'Showing results from available sources; current evidence may be incomplete.'
                )}
          </AlertDescription>
        </Alert>
      )}
      {!hits.length && data.coverage !== 'unavailable' && (
        <KnowledgeEmpty
          title={t('session.knowledgeTool.searchEmptyTitle', 'No related materials found yet')}
          description={t(
            'session.knowledgeTool.searchEmptyDescription',
            'Try rephrasing the question or adjusting the knowledge source scope.'
          )}
        />
      )}
      <div className={cn('grid min-w-0 grid-cols-1 gap-3', hits.length > 1 && '@min-[32rem]:grid-cols-2')}>
        {hits.map(
          (hit, index) =>
            hit && (
              <KnowledgeEvidenceCard
                key={`${hit.citationId ?? 'source'}-${index}`}
                evidence={hit}
                index={index}
              />
            )
        )}
      </div>
      {data.hits.length > 20 && (
        <p className="text-xs text-muted-foreground">
          {t('session.knowledgeTool.evidenceTruncated', 'Showing only the first 20 pieces of evidence.')}
        </p>
      )}
    </div>
  );
}

/**
 * Render a compact directory using actual scope and remote availability, without fabricating document statistics.
 */
function KnowledgeCollections({ items, total }: { items: Record<string, unknown>[]; total: unknown }) {
  const { t } = useI18n();
  const visible = items.slice(0, 100);
  return (
    <div className="@container flex min-w-0 flex-col gap-4">
      <KnowledgeHeading
        title={t('session.knowledgeTool.catalogTitle', 'Knowledge catalog')}
        description={t(
          'session.knowledgeTool.catalogDescription',
          'Knowledge collections accessible this time'
        )}
        count={t('session.knowledgeTool.collectionCount', '{{count}} collections', {
          count:
            typeof total === 'number' && Number.isSafeInteger(total) && total >= items.length
              ? total
              : items.length,
        })}
      />
      {!visible.length && (
        <KnowledgeEmpty
          title={t('session.knowledgeTool.catalogEmptyTitle', 'No knowledge collections available')}
          description={t(
            'session.knowledgeTool.catalogEmptyDescription',
            'Add materials or adjust the source scope, then continue asking.'
          )}
        />
      )}
      <div className={cn('grid min-w-0 grid-cols-1 gap-3', visible.length > 1 && '@min-[32rem]:grid-cols-2')}>
        {visible.map((item, index) => (
          <Card key={`${String(item.id ?? 'collection')}-${index}`} size="sm" className="min-w-0">
            <CardHeader>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <BookOpenIcon className="size-4 text-primary" aria-hidden="true" />
                {isRecord(item.scope) &&
                  (item.scope.kind === 'global' || item.scope.kind === 'workspace') && (
                    <Badge variant="secondary">
                      {item.scope.kind === 'global'
                        ? t('session.knowledgeMode.scopeGlobal', 'Global')
                        : t('session.knowledgeMode.scopeWorkspace', 'Workspace')}
                    </Badge>
                  )}
                {item.source === 'remote' && (
                  <Badge variant="outline">{t('session.knowledgeTool.remoteBadge', 'Remote mount')}</Badge>
                )}
                {item.remoteState === 'unavailable' && (
                  <Badge variant="outline">
                    {t('session.knowledgeTool.unavailableBadge', 'Temporarily unavailable')}
                  </Badge>
                )}
              </div>
              <CardTitle className="line-clamp-2 wrap-anywhere">
                {(item.name as string).slice(0, 240)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="line-clamp-3 wrap-anywhere">
                {readString(item, 'description')?.slice(0, 600) ??
                  t('session.knowledgeTool.noDescription', 'This collection has no description yet.')}
              </CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>
      {typeof total === 'number' && total > visible.length && (
        <p className="text-xs text-muted-foreground">
          {t('session.knowledgeTool.catalogSummary', 'Showing {{shown}} of {{total}} collections.', {
            shown: visible.length,
            total,
          })}
        </p>
      )}
    </div>
  );
}

/**
 * Share a restrained library marker and count across discovery and retrieval, using current theme tokens.
 */
function KnowledgeHeading({
  title,
  description,
  count,
}: {
  title: string;
  description: string;
  count: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
        <LibraryBigIcon className="size-5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      <Badge variant="secondary">{count}</Badge>
    </div>
  );
}

/**
 * Distinguish an empty result from a failed source using the shared Empty primitive.
 */
function KnowledgeEmpty({ title, description }: { title: string; description: string }) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchXIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/**
 * Show an accessible loading state only before structured or model-facing output arrives.
 */
function KnowledgeLoading() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Searching knowledge materials">
      <span className="sr-only">{t('session.knowledgeTool.loading', 'Searching knowledge materials')}</span>
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-xl" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-40" />
        </div>
      </div>
      <Skeleton className="h-28 w-full rounded-xl" />
    </div>
  );
}
