/**
 * @author Codex
 * @description Manages collection selection, pagination, and creation within one knowledge scope.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { CloudIcon, LibraryBigIcon, PlusIcon, TriangleAlertIcon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import { ListPagination } from '@/components/ListPagination';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '@octopus/ui/components/empty';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@octopus/ui/components/alert';
import { Badge } from '@octopus/ui/components/badge';
import { Skeleton } from '@octopus/ui/components/skeleton';
import { KnowledgeQueryErrorToast } from './KnowledgeQueryErrorToast';
import { listKnowledgeCollections } from '@/api/knowledge';
import { CreateCollectionDialog } from './CreateCollectionDialog';
import { KnowledgeDocuments } from './KnowledgeDocuments';
import { KnowledgeSearchAction } from './KnowledgeSearchAction';
import { ScrollArea } from '@octopus/ui/components/scroll-area';
import { KnowledgeCollectionItem } from './KnowledgeCollectionItem';
import { useI18n } from '@/i18n/use-i18n';

/**
 * Keeps transient collection state isolated from other scopes and Agent drafts.
 */
export function KnowledgeDirectory({
  workspaceId,
  creating,
  onCreatingChange,
}: {
  workspaceId?: string;
  creating: boolean;
  /**
   * Opens or closes collection creation for the current scope.
   */
  onCreatingChange(creating: boolean): void;
}) {
  const [page, setPage] = useState(1);
  const navigate = useNavigate();
  const { t } = useI18n();
  const selectedId = useSearch({ strict: false }).collection;
  const queryClient = useQueryClient();
  const collections = useQuery({
    queryKey: ['knowledge', workspaceId ?? 'global', 'collections', page],
    queryFn: ({ signal }) => listKnowledgeCollections(workspaceId, page, signal),
  });
  const items = collections.data?.items;
  const selected = items?.find((item) => item.id === selectedId) ?? items?.[0];

  /**
   * Converges deep links and stale ids onto the resolved selection.
   */
  useEffect(() => {
    if (!collections.data) {
      return;
    }
    if (selected !== undefined && selected.id !== selectedId) {
      void navigate({
        to: '.',
        search: (previous) => ({ ...previous, collection: selected.id }),
        replace: true,
        resetScroll: false,
      });
    } else if (selected === undefined && selectedId !== undefined) {
      void navigate({
        to: '.',
        search: (previous) => ({ ...previous, collection: undefined }),
        replace: true,
        resetScroll: false,
      });
    }
  }, [collections.data, selected, selectedId, navigate]);

  /**
   * Selects a collection through the URL so refresh and sharing restore it.
   */
  function handleSelect(id: string) {
    void navigate({
      to: '.',
      search: (previous) => ({ ...previous, collection: id }),
      replace: true,
      resetScroll: false,
    });
  }
  /**
   * Selects collectionsis pending in the existing condition order.
   */
  /**
   * Renders the selected local or read-only remote collection without changing selection ownership.
   */
  function renderSelectedCollection() {
    if (!selected) {
      return null;
    }
    if (selected.source === 'remote') {
      return (
        <div className="flex flex-col gap-5" key={selected.id}>
          <section className="rounded-2xl border bg-card p-5">
            <div className="flex min-w-0 items-start gap-4">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <CloudIcon className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2 className="text-base font-semibold tracking-tight">{selected.name}</h2>
                  <Badge variant="outline">
                    {selected.remoteState === 'ready'
                      ? t('knowledge.directory.remoteReady', 'Remote · read-only')
                      : t('knowledge.directory.remotePending', 'Remote · pending recovery')}
                  </Badge>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {selected.description ||
                    t(
                      'knowledge.directory.remoteDescription',
                      'A shared knowledge collection managed by a remote Dr.Octopus instance.'
                    )}
                </p>
                <p className="mt-2 text-xs text-muted-foreground/80">
                  {t(
                    'knowledge.directory.remoteSource',
                    'Source: {{ref}} · Documents and indexing are managed by the peer',
                    { ref: selected.connectionRef }
                  )}
                </p>
              </div>
              <KnowledgeSearchAction collection={selected} />
            </div>
          </section>
        </div>
      );
    }
    return <KnowledgeDocuments key={selected.id} workspaceId={workspaceId} collection={selected} />;
  }
  function renderCollections() {
    if (collections.isPending) {
      return (
        <div
          role="status"
          aria-label="Loading knowledge base…"
          className="grid min-h-0 items-start gap-5 lg:h-full lg:grid-cols-[264px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]"
        >
          <aside className="flex max-h-full min-h-0 flex-col gap-1 overflow-hidden rounded-2xl border bg-card/60 p-2">
            <div className="flex shrink-0 items-center justify-between px-3 pb-1.5 pt-2">
              <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                {t('knowledge.directory.collections', 'Collections')}
              </p>
            </div>
            {[0, 1, 2, 3].map((row) => (
              <Skeleton key={row} className="h-14 rounded-xl" />
            ))}
            <span className="sr-only">{t('knowledge.directory.loading', 'Loading knowledge base…')}</span>
          </aside>
          <section className="rounded-2xl border bg-card p-5">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="mt-2.5 h-4 w-64 max-w-full" />
          </section>
        </div>
      );
    } else if (collections.isError && items === undefined) {
      return (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>
            {t('knowledge.directory.loadFailed', 'Failed to load knowledge collections')}
          </AlertTitle>
          <AlertDescription>{collections.error.message}</AlertDescription>
          <AlertAction>
            <Button variant="outline" size="sm" onClick={() => void collections.refetch()}>
              {t('common.retry', 'Retry')}
            </Button>
          </AlertAction>
        </Alert>
      );
    } else if (items !== undefined && items.length > 0) {
      return (
        <div className="grid p-0.5 min-h-0 items-start gap-5 lg:h-full lg:grid-cols-[264px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
          <aside className="flex max-h-full min-h-0 flex-col gap-0.5 overflow-hidden rounded-xl border bg-card/60">
            <div className="flex shrink-0 items-center justify-between px-5 py-4 border-b">
              <p className="text-sm font-semibold tracking-wider text-muted-foreground uppercase">
                {t('knowledge.directory.collections', 'Collections')}
              </p>
              <Badge variant="secondary" className="h-5 rounded-md px-1.5 text-xs tabular-nums">
                {collections.data?.total ?? items.length}
              </Badge>
            </div>
            <ScrollArea className="flex min-h-0 flex-col overflow-hidden *:data-[slot=scroll-area-viewport]:h-auto *:data-[slot=scroll-area-viewport]:max-h-48 *:data-[slot=scroll-area-viewport]:min-h-0 *:data-[slot=scroll-area-viewport]:flex-1 lg:*:data-[slot=scroll-area-viewport]:max-h-none">
              <div className="flex flex-col gap-0.5 p-2">
                {items.map((item) => (
                  <KnowledgeCollectionItem
                    key={item.id}
                    workspaceId={workspaceId}
                    collection={item}
                    active={item.id === selected?.id}
                    onSelect={() => handleSelect(item.id)}
                  />
                ))}
              </div>
            </ScrollArea>
            {(collections.data?.total ?? 0) > 20 || page > 1 ? (
              <ListPagination
                aria-label="Collection pagination"
                className="mt-1.5 border-t border-border/60 pt-1.5"
                compact
                page={page}
                pageCount={Math.ceil((collections.data?.total ?? 0) / 20)}
                disabled={collections.isFetching}
                onPageChange={setPage}
              />
            ) : null}
          </aside>
          {renderSelectedCollection()}
        </div>
      );
    } else {
      return (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LibraryBigIcon />
            </EmptyMedia>
            <EmptyTitle>
              {t('knowledge.directory.emptyTitle', 'Start with your first knowledge collection')}
            </EmptyTitle>
            <EmptyDescription>
              {t(
                'knowledge.directory.emptyDescription',
                'Product docs, project materials, and team experience can all become knowledge sources for the agent.'
              )}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => onCreatingChange(true)}>
              <PlusIcon data-icon="inline-start" />
              {t('knowledge.directory.create', 'Create knowledge collection')}
            </Button>
          </EmptyContent>
        </Empty>
      );
    }
  }
  return (
    <>
      {collections.data ? (
        <KnowledgeQueryErrorToast
          key={page}
          title={t('knowledge.directory.loadFailed', 'Failed to load knowledge collections')}
          error={collections.error}
        />
      ) : null}
      {renderCollections()}
      {creating ? (
        <CreateCollectionDialog
          workspaceId={workspaceId}
          onClose={() => onCreatingChange(false)}
          onCreated={(collection) => {
            onCreatingChange(false);
            setPage(1);
            handleSelect(collection.id);
            void queryClient.invalidateQueries({
              queryKey: ['knowledge', workspaceId ?? 'global', 'collections'],
            });
          }}
        />
      ) : null}
    </>
  );
}
