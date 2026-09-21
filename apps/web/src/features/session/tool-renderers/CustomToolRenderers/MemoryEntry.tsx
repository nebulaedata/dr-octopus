/**
 * @author Codex
 * @description Renders one historical memory excerpt and its supplied evidence using progressive disclosure.
 */

import { ChevronDownIcon, QuoteIcon, UnlinkIcon } from 'lucide-react';
import { Badge } from '@octopus/ui/components/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@octopus/ui/components/collapsible';
import { Item, ItemContent } from '@octopus/ui/components/item';
import { useI18n } from '@/i18n/use-i18n';
import type { MemoryEntryProjection } from './memory-tool-projection';

/**
 * Keeps the fact prominent and source excerpts secondary; supplied text remains inert and bounded.
 */
export function MemoryEntry({ entry, index }: { entry: MemoryEntryProjection; index: number }) {
  const { t } = useI18n();
  return (
    <Item variant="muted" role="listitem" className="items-start gap-3 p-4">
      <span className="pt-0.5 text-xs font-medium tabular-nums text-muted-foreground" aria-hidden="true">
        {String(index + 1).padStart(2, '0')}
      </span>
      <ItemContent className="min-w-0 gap-2.5">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <h4 className="min-w-0 flex-1 wrap-anywhere text-sm font-medium leading-6">{entry.topic}</h4>
          <div className="flex shrink-0 items-center gap-1.5">
            {entry.unavailable && (
              <UnlinkIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
            )}
            <Badge variant="outline">{entry.type}</Badge>
            {entry.superseded && (
              <Badge variant="secondary">
                {t('session.memoryTool.entry.superseded', 'Historical version')}
              </Badge>
            )}
          </div>
        </div>
        {entry.body === undefined ? (
          <p className="wrap-anywhere text-sm leading-6 text-muted-foreground">{entry.summary}</p>
        ) : (
          <div className="max-h-72 overflow-auto overscroll-contain">
            <p className="whitespace-pre-wrap wrap-anywhere text-sm leading-7">
              {entry.body || entry.summary}
            </p>
          </div>
        )}
        {entry.body !== undefined && (
          <Collapsible className="mt-1">
            <CollapsibleTrigger className="group flex items-center gap-1.5 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              <QuoteIcon className="size-3.5" aria-hidden="true" />
              {t('session.memoryTool.entry.sources', 'Memory sources')}
              <span>{'· v'}{entry.revision}</span>
              <ChevronDownIcon
                className="size-3 transition-transform group-data-panel-open:rotate-180"
                aria-hidden="true"
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-3 flex max-h-48 flex-col gap-3 overflow-auto overscroll-contain">
                {entry.sources.length ? (
                  entry.sources.map((source, sourceIndex) => (
                    <blockquote
                      key={sourceIndex}
                      className="border-l-2 border-primary/25 pl-3 text-xs leading-6 whitespace-pre-wrap wrap-anywhere text-muted-foreground"
                    >
                      {source || t('session.memoryTool.entry.sourceEmpty', 'This source has no text excerpt.')}
                    </blockquote>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t('session.memoryTool.entry.noSources', 'This result has no source excerpts.')}
                  </p>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
        {entry.truncated && (
          <p className="text-xs text-muted-foreground">
            {t('session.memoryTool.entry.truncated', 'Content shortened; see the raw result for full output.')}
          </p>
        )}
      </ItemContent>
    </Item>
  );
}
