/**
 * @author Codex
 * @description Provides searchable task tools with policy explanations and measured virtual rows.
 */
import { useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Checkbox } from '@octopus/ui/components/checkbox';
import { CheckboxHalf } from '@/components/CheckboxHalf';
import { Badge } from '@octopus/ui/components/badge';
import { ScrollArea } from '@octopus/ui/components/scroll-area';
import { filterTaskTools, selectTaskToolMatches } from './schedule-tool-selection';
import { SearchInput } from '@/components/SearchInput';
import { useI18n } from '@/i18n/use-i18n';
import type { TaskToolCatalogEntry } from '@octopus/shared/protocol/scheduled-tasks';

/**
 * Virtualize rendering only; search and select-all always operate on the entire loaded catalog.
 */
export function ScheduleToolPicker({
  tools,
  selected,
  disabled,
  onChange,
}: {
  tools: TaskToolCatalogEntry[];
  selected: string[];
  disabled: boolean;
  onChange(selected: string[]): void;
}) {
  'use no memo'; // TanStack Virtual exposes live measurements that React Compiler must not freeze.
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const scrollRoot = useRef<HTMLDivElement>(null);
  const matches = filterTaskTools(tools, query);
  const selectable = matches.filter((tool) => !tool.unavailableReason);
  const selectedMatches = selectable.filter((tool) => selected.includes(tool.identity)).length;
  const totalSelected = tools.filter(
    (tool) => !tool.unavailableReason && selected.includes(tool.identity)
  ).length;
  // eslint-disable-next-line react-hooks/incompatible-library -- This component explicitly opts out of compilation above.
  const virtualizer = useVirtualizer({
    count: matches.length,
    getScrollElement: () =>
      scrollRoot.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]') ?? null,
    estimateSize: () => 160,
    getItemKey: (index) => matches[index]!.identity,
    overscan: 5,
  });
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <SearchInput
        id="schedule-tool-search"
        value={query}
        placeholder={t('schedules.toolPicker.searchPlaceholder', 'Search name, description, or source')}
        onChange={(event) => {
          setQuery(event.target.value);
          virtualizer.scrollToOffset(0);
        }}
      />
      <p className="text-xs text-muted-foreground" role="status">
        {t(
          'schedules.toolPicker.summary',
          '{{total}} tools total, {{matched}} matched, {{selectable}} selectable; {{selected}} selected in total',
          {
            total: tools.length,
            matched: matches.length,
            selectable: selectable.length,
            selected: totalSelected,
          }
        )}
      </p>
      <label className="inline-flex items-center gap-3 text-sm w-fit">
        <CheckboxHalf
          checked={selectable.length > 0 && selectedMatches === selectable.length}
          indeterminate={selectedMatches > 0 && selectedMatches < selectable.length}
          disabled={disabled || selectable.length === 0}
          onCheckedChange={(checked) => onChange(selectTaskToolMatches(selected, matches, checked))}
        />
        {query.trim()
          ? t('schedules.toolPicker.selectAllMatches', 'Select all search results')
          : t('schedules.toolPicker.selectAllSelectable', 'Select all authorizable tools')}
        {' ('}
        {selectedMatches}/{selectable.length})
      </label>
      <ScrollArea
        ref={scrollRoot}
        className="h-105 rounded-lg border"
        aria-label="Tool catalog"
      >
        {matches.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            {t('schedules.toolPicker.emptyMatches', 'No matching tools. Adjust the search criteria.')}
          </p>
        ) : (
          <div
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
            role="group"
            aria-label="Authorizable tool options"
          >
            {virtualizer.getVirtualItems().map((row) => {
              const tool = matches[row.index]!;
              return (
                <div
                  key={row.key}
                  data-index={row.index}
                  ref={virtualizer.measureElement}
                  className="absolute top-0 left-0 w-full px-3"
                  style={{ transform: `translateY(${row.start}px)` }}
                >
                  <label className="flex items-start gap-3 border-b py-4 text-sm">
                    <Checkbox
                      aria-label={tool.name}
                      checked={!tool.unavailableReason && selected.includes(tool.identity)}
                      disabled={disabled || !!tool.unavailableReason}
                      className="mt-0.5"
                      onCheckedChange={(checked) =>
                        onChange(selectTaskToolMatches(selected, [tool], checked))
                      }
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-2">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium font-geist">{tool.name}</span>
                        {tool.unavailableReason && (
                          <Badge variant="secondary">
                            {t('schedules.toolPicker.unauthorizedBadge', 'Not authorizable')}
                          </Badge>
                        )}
                      </span>
                      <span className="wrap-break-word text-xs text-muted-foreground">
                        {t('schedules.toolPicker.sourcePrefix', 'Source: {{source}}', {
                          source: tool.source ?? t('schedules.toolPicker.sourceMissing', 'No source provided'),
                        })}
                      </span>
                      <span className="whitespace-pre-wrap text-xs text-muted-foreground wrap-anywhere">
                        {tool.description}
                      </span>
                      {tool.unavailableReason && (
                        <span className="text-xs text-destructive">{tool.unavailableReason}</span>
                      )}
                    </span>
                  </label>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
      <p className="text-xs text-muted-foreground">
        {t(
          'schedules.toolPicker.footerNote',
          'This list shows tools registered in the latest preflight, excluding unsupported interaction and control tools; richer tool authorization improves Agent capability.'
        )}
      </p>
    </div>
  );
}
