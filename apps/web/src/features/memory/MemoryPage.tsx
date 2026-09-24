/**
 * @author Codex
 * @description Global memory data management with a policy summary and entry into memory Settings.
 */
import { useState } from 'react';
import { useDebounce } from 'ahooks';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowUpRightIcon, BrainIcon, PlusIcon, RefreshCwIcon, Settings2Icon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import { ListPagination } from '@/components/ListPagination';
import { SearchInput } from '@/components/SearchInput';
import { Badge } from '@octopus/ui/components/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardFooter } from '@octopus/ui/components/card';
import { Alert, AlertDescription } from '@octopus/ui/components/alert';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '@octopus/ui/components/empty';
import { Skeleton } from '@octopus/ui/components/skeleton';
import { Page } from '@/components/Page';
import { PageHero } from '@/components/PageHero';
import { memoryIndexesQuery, memoryStatusQuery, memoryQueryKey } from '@/queries/memory-queries';
import { useI18n } from '@/i18n/use-i18n';
import { MemoryEditor } from './MemoryEditor';
import { MemoryDetail } from './MemoryDetail';
import { Tooltip, TooltipContent, TooltipTrigger } from '@octopus/ui/components/tooltip';
import type { MemoryRef } from '@octopus/shared/protocol/memory';
/**
 * Display bounded global pages while keeping policy changes in Settings.
 */
export function MemoryPage() {
  const { t } = useI18n();
  const client = useQueryClient();
  const status = useQuery(memoryStatusQuery());
  const [text, setText] = useState('');
  const query = useDebounce(text.trim(), { wait: 300 });
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const cursor = cursors.at(-1);
  const directory = useQuery(memoryIndexesQuery(query, cursor));
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<MemoryRef>();
  const mode = status.data?.mode;
  const error = status.error ?? directory.error;
  /**
   * Restart revision-bound pagination after writes in any Host.
   */
  function refresh() {
    setCursors([undefined]);
    void client.invalidateQueries({ queryKey: memoryQueryKey });
  }
  /**
   * Selects badge content in the existing condition order.
   */
  function renderBadgeContent() {
    if (mode === 'off') {
      return t('memory.page.modeOff', 'Memory off');
    } else if (mode === 'manual') {
      return t('memory.page.modeManual', 'Manual mode');
    } else {
      return t('memory.page.modeAuto', 'Auto mode');
    }
  }
  return (
    <Page classNames={{ content: 'pb-8' }}>
      <PageHero
        title={t('memory.page.title', 'Memory')}
        description={t(
          'memory.page.description',
          'Long-term memory shared across workspaces. Keeps your preferences, decisions, and conventions for the agent to consult when needed.'
        )}
        extra={
          <>
            <Tooltip>
              <TooltipTrigger>
                <Button
                  nativeButton={false}
                  variant="ghost"
                  size="icon"
                  render={
                    <Link
                      to="."
                      search={(previous) => ({
                        ...previous,
                        settings: { path: '/settings/memory' },
                      })}
                      mask={{ to: '/settings/memory', unmaskOnReload: true }}
                    />
                  }
                >
                  <Settings2Icon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('memory.page.settingsTooltip', 'Memory settings')}</TooltipContent>
            </Tooltip>
            <Button onClick={() => setCreating(true)}>
              <PlusIcon data-icon="inline-start" />
              {t('memory.remember', 'Remember something')}
            </Button>
          </>
        }
      />
      <section aria-label="Memory overview" className="flex flex-nowrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{t('memory.page.global', 'Global memory')}</span>
          <Badge variant="secondary">
            {status.data
              ? t('memory.page.count', '{{count}} entry', {
                  count: status.data.count,
                  defaultValue_other: '{{count}} entries',
                })
              : t('memory.page.loading', 'Loading')}
          </Badge>
          {mode && <Badge variant="outline">{renderBadgeContent()}</Badge>}
        </div>
      </section>
      <section aria-label="toolbar" className="flex flex-nowrap items-center justify-between gap-4">
        <SearchInput
          aria-label="Search memories"
          placeholder={t('memory.page.searchPlaceholder', 'Search memory indexes or topics…')}
          className="max-w-sm"
          maxLength={300}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setCursors([undefined]);
          }}
        />
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" aria-label="Refresh memories" onClick={refresh}>
            <RefreshCwIcon />
            {t('common.refresh', 'Refresh')}
          </Button>
          <Button
            nativeButton={false}
            variant="outline"
            size="sm"
            render={<a href="/api/memory/export" download="memory.md" />}
          >
            <ArrowUpRightIcon />
            {t('common.export', 'Export')}
          </Button>
        </div>
      </section>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error.message}
            <Button size="sm" variant="outline" onClick={refresh}>
              {t('memory.page.refreshHome', 'Refresh and go home')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {directory.data?.searchUnavailable && (
        <Alert>
          <AlertDescription>
            {t(
              'memory.page.searchUnavailable',
              'Full-text search is unavailable. Clear the search term to browse the directory.'
            )}
          </AlertDescription>
        </Alert>
      )}
      {directory.isPending && <Skeleton className="min-h-40 w-full" />}
      {!directory.isPending && !directory.error && !directory.data?.items.length && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BrainIcon />
            </EmptyMedia>
            <EmptyTitle>
              {query
                ? t('memory.page.emptySearchTitle', 'No matching indexes')
                : t('memory.page.emptyTitle', 'No long-term memories yet')}
            </EmptyTitle>
            <EmptyDescription>
              {query
                ? t(
                    'memory.page.emptySearchDescription',
                    'Try another keyword, or clear the search to keep browsing.'
                  )
                : t(
                    'memory.page.emptyDescription',
                    'Click "Remember something" to save preferences and conventions.'
                  )}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {!directory.error && (
        <div className="grid gap-3 sm:grid-cols-2">
          {directory.data?.items.map((item) => (
            <Card key={item.storeId + item.indexId} size="sm">
              <CardHeader className="flex flex-col flex-1">
                <CardDescription className="shrink-0 font-geist">{item.topic}</CardDescription>
                <CardTitle className="flex-1 line-clamp-3 wrap-anywhere">{item.indexText}</CardTitle>
              </CardHeader>
              <CardFooter className="justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {new Date(item.updatedAt).toLocaleDateString()} ·{' '}
                  {t('memory.page.revision', 'v{{revision}}', { revision: item.revision })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelected({ storeId: item.storeId, indexId: item.indexId })}
                >
                  {t('memory.page.view', 'View memory')}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
      {!query && !directory.error && (
        <ListPagination
          aria-label="Memory pagination"
          className="pb-4"
          page={cursors.length}
          hasNextPage={Boolean(directory.data?.nextCursor)}
          disabled={directory.isFetching}
          onPageChange={(page) =>
            setCursors((current) =>
              page < current.length ? current.slice(0, page) : [...current, directory.data?.nextCursor]
            )
          }
        />
      )}
      {query && directory.data && (
        <p className="pb-4 text-xs text-muted-foreground">
          {t(
            'memory.page.searchHint',
            'Search shows candidate indexes. Clear the keyword to browse all memories.'
          )}
        </p>
      )}
      {creating && (
        <MemoryEditor
          onClose={() => {
            setCreating(false);
            setCursors([undefined]);
          }}
        />
      )}
      {selected && (
        <MemoryDetail
          key={selected.storeId + selected.indexId}
          reference={selected}
          onClose={() => {
            setSelected(undefined);
            refresh();
          }}
        />
      )}
    </Page>
  );
}
