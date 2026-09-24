/**
 * @author Codex
 * @description Presents collection navigation with creation dates and cached live document totals.
 */
import { useQuery } from '@tanstack/react-query';
import { BookOpenIcon } from 'lucide-react';
import { KnowledgeCollectionActions } from './KnowledgeCollectionActions';
import { Badge } from '@octopus/ui/components/badge';
import { cn } from '@octopus/ui/lib/utils';
import { listKnowledgeDocuments } from '@/api/knowledge';
import { useI18n } from '@/i18n/use-i18n';
import type { KnowledgeCollection } from '@octopus/shared/protocol/knowledge';

/**
 * Shares the document view's first-page cache; remote sources never issue local management queries.
 */
export function KnowledgeCollectionItem({
  workspaceId,
  collection,
  active,
  onSelect,
}: {
  workspaceId?: string;
  collection: KnowledgeCollection;
  active: boolean;
  /**
   * Selects this collection in the current directory.
   */
  onSelect(): void;
}) {
  const { t } = useI18n();
  const documents = useQuery({
    queryKey: ['knowledge', workspaceId ?? 'global', collection.id, 'documents', 1],
    queryFn: ({ signal }) => listKnowledgeDocuments(workspaceId, collection.id, 1, signal),
    enabled: collection.source !== 'remote',
    select: (data) => data.total,
    staleTime: 30000,
  });
  const createdAt = new Date(collection.createdAt);
  const date = Number.isNaN(createdAt.getTime()) ? undefined : createdAt.toLocaleDateString();
  let count: string;
  if (collection.source === 'remote') {
    count = t('knowledge.collectionItem.countUnavailable', 'Document count unavailable');
  } else if (documents.data !== undefined) {
    count = t('knowledge.collectionItem.documentCount', '{{count}} documents', { count: documents.data });
  } else if (documents.isError) {
    count = t('knowledge.collectionItem.countFailed', 'Failed to load count');
  } else {
    count = t('knowledge.collectionItem.loading', 'Loading…');
  }
  return (
    <div
      data-active={active || undefined}
      className={cn(
        'group relative flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors duration-150',
        active ? 'bg-primary/8 text-foreground' : 'text-foreground hover:bg-muted'
      )}
    >
      {active ? (
        <span
          aria-hidden="true"
          className="absolute top-1/2 left-0 h-5 w-0.75 -translate-y-1/2 rounded-full bg-primary"
        />
      ) : null}
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors',
            active
              ? 'bg-primary/15 text-primary'
              : 'bg-muted text-muted-foreground group-hover:text-foreground'
          )}
        >
          <BookOpenIcon className="size-4" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-sm font-medium" title={collection.name}>
              {collection.name}
            </span>
            {collection.source === 'remote' ? (
              <Badge variant="outline">{t('knowledge.collectionItem.remoteBadge', 'Remote')}</Badge>
            ) : null}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {date ? (
              <time
                dateTime={collection.createdAt}
                title={t('knowledge.collectionItem.createdTitle', 'Created {{date}}', {
                  date: createdAt.toLocaleString(),
                })}
              >
                {date}
              </time>
            ) : (
              <span>{t('knowledge.collectionItem.dateUnavailable', 'Date unavailable')}</span>
            )}
            <span aria-hidden="true">·</span>
            <span>{count}</span>
          </span>
        </span>
      </button>
      {collection.source !== 'remote' ? (
        <KnowledgeCollectionActions workspaceId={workspaceId} collection={collection} />
      ) : null}
    </div>
  );
}
