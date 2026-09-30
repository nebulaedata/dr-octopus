/**
 * @author Codex
 * @description 展示 Agent 工具执行参数、流式结果与终态
 */

import { CheckCircle2Icon, ChevronRightIcon, XCircleIcon } from 'lucide-react';
import { useState } from 'react';
import { TimelineItem } from '@octopus/custom-ui/components/timeline';
import { formatDuration } from '@octopus/custom-ui/components/elapsed-time';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@octopus/ui/components/collapsible';
import { Spinner } from '@octopus/ui/components/spinner';
import { Marker, MarkerContent } from '@octopus/ui/components/marker';
import { cn } from '@octopus/ui/lib/utils';
import { useI18n } from '@/i18n/use-i18n';
import { ToolRenderer } from './ToolRenderers/ToolRenderer';
import { customToolLabel } from './utils/tool-label';
import type { ToolRendererSelection } from './ToolRenderers/ToolRenderer';
import type { Translate } from '@/i18n/use-i18n';
import type { ToolProjection } from '@/stores/session';

/**
 * Maps one tool execution status to its localized badge label, passing future states through.
 */
function toolStatusLabel(t: Translate, status: ToolProjection['status']): string {
  switch (status) {
    case 'running':
      return t('session.toolCard.status.running', 'Running');
    case 'success':
      return t('session.toolCard.status.success', 'Success');
    case 'error':
      return t('session.toolCard.status.error', 'Error');
    default:
      return status;
  }
}

/**
 * 渲染一个可折叠工具执行记录。
 */
export function ToolCard({ tool }: { tool: ToolProjection }) {
  return (
    <ToolRenderer tool={tool}>
      {(renderer) => <ToolCardView tool={tool} renderer={renderer} />}
    </ToolRenderer>
  );
}
/**
 * Keeps collapse state and common chrome independent of tool-specific registration.
 */
function ToolCardView({ tool, renderer }: { tool: ToolProjection; renderer: ToolRendererSelection }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const Renderer = renderer.component;
  const label =
    renderer.getLabel?.(tool, t) ?? customToolLabel(t, tool.name) ?? renderer.label?.[tool.name] ?? tool.name;
  const summary = renderer.summarize?.(tool, t);
  let StatusIcon;
  if (tool.status === 'running') {
    StatusIcon = Spinner;
  } else if (tool.status === 'success') {
    StatusIcon = CheckCircle2Icon;
  } else {
    StatusIcon = XCircleIcon;
  }
  return (
    <TimelineItem
      density="compact"
      extendLine={open}
      icon={<StatusIcon className={tool.status === 'running' ? 'motion-reduce:animate-none' : undefined} />}
      iconClassName={cn(
        tool.status === 'success' && 'text-success',
        tool.status === 'error' && 'text-destructive'
      )}
    >
      <Collapsible open={open} onOpenChange={setOpen} className="min-w-0">
        <CollapsibleTrigger
          title={label === tool.name ? tool.name : `${label} · ${tool.name}`}
          className="group flex min-h-9 w-full min-w-0 items-center gap-2 rounded-md py-2 pr-2 text-left text-xs outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
            <Marker
              render={<span />}
              className={cn(
                'min-w-0 w-auto text-xs font-medium text-foreground',
                summary !== undefined && 'sm:max-w-1/2 sm:shrink-0'
              )}
            >
              <MarkerContent className={cn('truncate', tool.status === 'running' && 'shimmer')}>
                {label}
              </MarkerContent>
            </Marker>
            {summary === undefined ? null : (
              <span className="min-w-0 truncate text-muted-foreground sm:flex-1" title={summary}>
                {summary}
              </span>
            )}
          </span>
          <span
            className={cn(
              'shrink-0 text-muted-foreground',
              tool.status === 'success' && 'sr-only',
              tool.status === 'error' && 'text-destructive'
            )}
          >
            {toolStatusLabel(t, tool.status)}
          </span>
          {tool.startedAt > 0 &&
          tool.endedAt !== undefined &&
          tool.endedAt > tool.startedAt &&
          Number.isFinite(tool.endedAt - tool.startedAt) ? (
            <span
              className="shrink-0 text-muted-foreground tabular-nums"
              title={t('session.toolTimeline.durationHint', 'Elapsed time from recorded timestamps')}
            >
              {formatDuration(tool.endedAt - tool.startedAt)}
            </span>
          ) : null}
          <ChevronRightIcon
            aria-hidden
            className="size-3.5 shrink-0 text-muted-foreground motion-safe:transition-transform group-data-panel-open:rotate-90"
          />
        </CollapsibleTrigger>
        <CollapsibleContent keepMounted={false}>
          {open ? (
            <div className="min-w-0 px-2 pt-2 pb-4">
              <Renderer tool={tool} />
            </div>
          ) : null}
        </CollapsibleContent>
      </Collapsible>
    </TimelineItem>
  );
}
