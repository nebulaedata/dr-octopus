/**
 * @author Codex
 * @description Presents memory discovery and reading as readable entries with honest coverage and raw-output fallback.
 */
import { Link } from '@tanstack/react-router';
import {
  ArrowUpRightIcon,
  BracesIcon,
  ChevronDownIcon,
  InfoIcon,
  SearchIcon,
  SearchXIcon,
} from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@octopus/ui/components/collapsible';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@octopus/ui/components/empty';
import { ItemGroup } from '@octopus/ui/components/item';
import { Skeleton } from '@octopus/ui/components/skeleton';
import { cn } from '@octopus/ui/lib/utils';
import { useI18n } from '@/i18n/use-i18n';
import { ToolContent } from '../ToolRendererParts';
import { MemoryEntry } from './MemoryEntry';
import { projectMemoryTool } from './memory-tool-projection';
import type { ToolRendererProps } from '../types';
/**
 * Render recognized metadata while retaining all native text, image and error output.
 *
 * The fallback branches stay hook-free so projection tests can invoke the renderer directly.
 */
export function MemoryToolRenderer({ tool }: ToolRendererProps) {
  if (tool.status === 'running' && tool.details === undefined && !tool.content.length) {
    return <MemoryLoading />;
  }
  return <MemoryToolBody tool={tool} />;
}

/**
 * Owns the projection's translation boundary below the hook-free wrapper.
 */
function MemoryToolBody({ tool }: ToolRendererProps) {
  const { t } = useI18n();
  const data = projectMemoryTool(t, tool);
  if (data === undefined) {
    return <ToolContent blocks={tool.content} />;
  }
  return <MemoryToolResult tool={tool} data={data} />;
}

/**
 * Renders the structured memory section once the projection has been validated.
 */
function MemoryToolResult({
  tool,
  data,
}: {
  tool: ToolRendererProps['tool'];
  data: NonNullable<ReturnType<typeof projectMemoryTool>>;
}) {
  const { t } = useI18n();
  return (
    <section
      className="@container flex min-w-0 flex-col gap-4"
      aria-label={data.action === 'read' ? 'Read memory result' : 'Recall memory result'}
    >
      {data.query && (
        <div className="flex min-w-0 items-start gap-2 text-xs leading-5 text-muted-foreground">
          <SearchIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span className="wrap-anywhere">{data.query}</span>
        </div>
      )}
      {data.items.length ? (
        <ItemGroup
          className={cn(
            'grid min-w-0 grid-cols-1 gap-3',
            data.action === 'recall' && '@min-[36rem]:grid-cols-2'
          )}
        >
          {data.items.map((entry, index) => (
            <MemoryEntry key={`${entry.id}:${index}`} entry={entry} index={index} />
          ))}
        </ItemGroup>
      ) : (
        <Empty className="py-7">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchXIcon />
            </EmptyMedia>
            <EmptyTitle>
              {data.action === 'read'
                ? t('session.memoryTool.readEmptyTitle', 'No readable memories this time')
                : t('session.memoryTool.recallEmptyTitle', 'No memory clues found this time')}
            </EmptyTitle>
            <EmptyDescription>
              {t('session.memoryTool.emptyDescription', 'Try different keywords, or browse the memory library.')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {data.notice && (
        <p className="flex items-start gap-1.5 text-xs leading-5 text-muted-foreground">
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {data.notice}
        </p>
      )}
      {data.total > data.items.length && (
        <p className="text-xs text-muted-foreground">
          {t(
            'session.memoryTool.showingFirst',
            'Showing the first {{count}} entries; see the raw result for full output.',
            { count: data.items.length }
          )}
        </p>
      )}
      <Collapsible>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CollapsibleTrigger className="group flex items-center gap-1.5 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <BracesIcon className="size-3.5" aria-hidden="true" />
            {t('session.memoryTool.rawResult', 'Raw result')}
            <ChevronDownIcon
              className="size-3 transition-transform group-data-panel-open:rotate-180"
              aria-hidden="true"
            />
          </CollapsibleTrigger>
          <Button nativeButton={false} variant="ghost" size="sm" render={<Link to="/memory" />}>
            {t('session.memoryTool.manageMemory', 'Manage memory')}
            <ArrowUpRightIcon data-icon="inline-end" aria-hidden="true" />
          </Button>
        </div>
        <CollapsibleContent className="mt-3 min-w-0">
          <ToolContent blocks={tool.content} />
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}

/**
 * Shows a stable, quiet placeholder while the read-only memory request is running.
 */
function MemoryLoading() {
  return (
    <div className="flex flex-col gap-3 py-2" aria-label="Loading memories">
      <Skeleton className="h-3 w-28" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
    </div>
  );
}
