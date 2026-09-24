/**
 * @author Codex
 * @description Searches one local or remote collection in a command dialog with ranked evidence and coverage feedback.
 */
import { useState } from 'react';
import { useDebounce } from 'ahooks';
import { useQuery } from '@tanstack/react-query';
import { BookOpenIcon, ChevronDownIcon, FileTextIcon, SearchIcon, SearchXIcon } from 'lucide-react';
import { Badge } from '@octopus/ui/components/badge';
import {
  Command,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
} from '@octopus/ui/components/command';
import { DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@octopus/ui/components/dialog';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '@octopus/ui/components/empty';
import { Alert, AlertTitle, AlertDescription } from '@octopus/ui/components/alert';
import { Kbd } from '@octopus/ui/components/kbd';
import { Separator } from '@octopus/ui/components/separator';
import { Spinner } from '@octopus/ui/components/spinner';
import { cn } from '@octopus/ui/lib/utils';
import { searchKnowledge } from '@/api/knowledge';
import { useI18n } from '@/i18n/use-i18n';
import type { KnowledgeCollection } from '@octopus/shared/protocol/knowledge';

/**
 * Debounces nonempty searches while keeping server relevance ordering and hiding stale evidence.
 */
export function KnowledgeSearchDialog({
  workspaceId,
  collection,
}: {
  workspaceId?: string;
  collection: KnowledgeCollection;
}) {
  const [expandedId, setExpandedId] = useState<string>();
  const [text, setText] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const { t } = useI18n();
  const trimmedQuery = text.trim();
  const debouncedQuery = useDebounce(trimmedQuery, { wait: 300 });
  const query = !isComposing && trimmedQuery === debouncedQuery ? debouncedQuery : '';
  const search = useQuery({
    queryKey: ['knowledge', 'search', workspaceId, collection.id, query],
    queryFn: ({ signal }) => searchKnowledge(workspaceId, [collection.id], query, signal),
    enabled: Boolean(query),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const data = query ? search.data : undefined;
  const isSearching = Boolean(trimmedQuery) && (!query || search.isFetching);
  const isSuccess = Boolean(query) && search.isSuccess;
  const isError = Boolean(query) && search.isError;
  const hits = data?.hits ?? [];
  const hasResults = isSuccess && hits.length > 0;
  const unavailable = data?.coverage === 'unavailable';
  /**
   * Selects empty description content in the existing condition order.
   */
  function renderEmptyDescriptionContent() {
    if (isSearching) {
      return t(
        'knowledge.searchDialog.searchingDescription',
        'Matching documents in the collection; please wait.'
      );
    } else if (isError) {
      return search.error?.message;
    } else if (unavailable) {
      return t(
        'knowledge.searchDialog.unavailableDescription',
        'Modify your question to search again once the search service recovers.'
      );
    } else if (isSuccess) {
      return t(
        'knowledge.searchDialog.noResultsDescription',
        'Try a more specific question or different keywords.'
      );
    } else {
      return t(
        'knowledge.searchDialog.startDescription',
        'Enter keywords or a full question to see the relevant source text directly.'
      );
    }
  }
  /**
   * Selects empty title content in the existing condition order.
   */
  function renderEmptyTitleContent() {
    if (isSearching) {
      return t('knowledge.searchDialog.searching', 'Searching for related knowledge…');
    } else if (isError) {
      return t('knowledge.searchDialog.errorTitle', 'Search temporarily failed');
    } else if (unavailable) {
      return t('knowledge.searchDialog.unavailableTitle', 'Search temporarily unavailable');
    } else if (isSuccess) {
      return t('knowledge.searchDialog.noResults', 'No related knowledge found');
    } else {
      return t('knowledge.searchDialog.startTitle', 'Start with a question');
    }
  }
  /**
   * Selects empty media content in the existing condition order.
   */
  function renderEmptyMediaContent() {
    if (isSearching) {
      return <Spinner />;
    } else if (isError || unavailable || isSuccess) {
      return <SearchXIcon />;
    } else {
      return <BookOpenIcon />;
    }
  }
  return (
    <DialogContent className="top-[12vh] flex max-h-[80dvh] translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
      <DialogHeader className="gap-3 px-5 pt-5 pb-4 pr-12">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <SearchIcon className="size-5" />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <DialogTitle>{t('knowledge.searchDialog.title', 'Search knowledge')}</DialogTitle>
            <DialogDescription className="flex min-w-0 items-center gap-1.5">
              <BookOpenIcon className="size-3.5 shrink-0" />
              <span className="truncate">{collection.name}</span>
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>
      <Command
        shouldFilter={false}
        loop
        className="min-h-0 flex-1 p-0"
        label={t('knowledge.searchDialog.commandLabel', 'Collection knowledge search')}
      >
        <div className="px-4 pb-4">
          <CommandInput
            aria-label="Search question"
            placeholder={t(
              'knowledge.searchDialog.placeholder',
              'Type a question to find related knowledge…'
            )}
            maxLength={2000}
            value={text}
            onValueChange={(value) => {
              setText(value);
              setExpandedId(undefined);
            }}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
          />
        </div>
        <Separator />
        <CommandList className="min-h-0 max-h-[52dvh] flex-1 scroll-py-2" aria-busy={isSearching}>
          {data && (data.coverage !== 'complete' || data.warnings.length > 0) ? (
            <Alert variant={unavailable ? 'destructive' : 'default'} className="mx-4 mt-4 w-auto">
              <AlertTitle>
                {unavailable
                  ? t('knowledge.searchDialog.unavailable', 'Search sources temporarily unavailable')
                  : t(
                      'knowledge.searchDialog.partialUnavailable',
                      'Some search capabilities temporarily unavailable'
                    )}
              </AlertTitle>
              <AlertDescription>
                {data.warnings.join(t('knowledge.common.listSeparator', '; ')) ||
                  t(
                    'knowledge.searchDialog.alertFallback',
                    'Check the model service and source connection, then retry.'
                  )}
              </AlertDescription>
            </Alert>
          ) : null}
          {hasResults ? (
            <CommandGroup
              heading={t('knowledge.searchDialog.resultsHeading', '{{count}} related results', {
                count: hits.length,
              })}
              className="p-2"
            >
              {hits.map((hit) => {
                /**
                 * Selects badge content in the existing condition order.
                 */
                function renderBadgeContent() {
                  if (hit.locator.page) {
                    return t('knowledge.searchDialog.locatorPage', 'Page {{page}}', {
                      page: hit.locator.page,
                    });
                  } else if (hit.locator.slide) {
                    return t('knowledge.searchDialog.locatorSlide', 'Slide {{slide}}', {
                      slide: hit.locator.slide,
                    });
                  } else {
                    return hit.locator.sheet ?? t('knowledge.searchDialog.locatorBody', 'Main text');
                  }
                }
                return (
                  <CommandItem
                    key={hit.citationId}
                    value={hit.citationId}
                    onSelect={() => setExpandedId(expandedId === hit.citationId ? undefined : hit.citationId)}
                    className="items-start gap-3 px-3 py-3"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <FileTextIcon />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 truncate font-medium">{hit.title}</span>
                        <Badge variant="outline">{renderBadgeContent()}</Badge>
                      </div>
                      <p
                        className={cn(
                          'text-sm leading-6 whitespace-pre-wrap text-muted-foreground wrap-break-word',
                          expandedId !== hit.citationId && 'line-clamp-2'
                        )}
                      >
                        {hit.text}
                      </p>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        {expandedId === hit.citationId
                          ? t('knowledge.searchDialog.collapse', 'Collapse text')
                          : t('knowledge.searchDialog.expand', 'Expand text')}
                        <ChevronDownIcon
                          className={cn('size-3', expandedId === hit.citationId && 'rotate-180')}
                        />
                      </span>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ) : (
            <Empty className="min-h-52 border-0 px-6 py-8" role="status">
              <EmptyHeader>
                <EmptyMedia variant="icon">{renderEmptyMediaContent()}</EmptyMedia>
                <EmptyTitle>{renderEmptyTitleContent()}</EmptyTitle>
                <EmptyDescription>{renderEmptyDescriptionContent()}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CommandList>
        <Separator />
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-xs text-muted-foreground">
          <span>
            {hasResults
              ? t(
                  'knowledge.searchDialog.sortedNote',
                  'Sorted by relevance · only the current collection is searched'
                )
              : t('knowledge.searchDialog.scopeNote', 'Only the current collection is searched')}
          </span>
          <span className="flex items-center gap-1.5">
            {hasResults ? (
              <>
                <Kbd className="font-geist">↑</Kbd>
                <Kbd className="font-geist">↓</Kbd>
                <span>{t('knowledge.searchDialog.hintSelect', 'Select')}</span>
                <Kbd className="font-geist">{'Enter'}</Kbd>
                <span>{t('knowledge.searchDialog.hintExpand', 'Expand')}</span>
              </>
            ) : null}
            <Kbd className="font-geist">{'Esc'}</Kbd>
            <span>{t('common.close', 'Close')}</span>
          </span>
        </div>
      </Command>
    </DialogContent>
  );
}
