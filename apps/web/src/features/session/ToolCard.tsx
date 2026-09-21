/**
 * @author Codex
 * @description 展示 Agent 工具执行参数、流式结果与终态
 */

import { CheckCircle2Icon, ChevronDownIcon, XCircleIcon } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@octopus/ui/components/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@octopus/ui/components/collapsible';
import { Spinner } from '@octopus/ui/components/spinner';
import { cn } from '@octopus/ui/lib/utils';
import { useI18n } from '@/i18n/use-i18n';
import { resolveToolRenderer } from './tool-renderers/registry';
import { customToolLabel } from './tool-renderers/custom-tool-renderer-definitions';
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
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const renderer = resolveToolRenderer(tool.name);
  const Renderer = renderer.component;
  const ToolIcon = renderer.icon;
  const summary = renderer.summarize?.(tool, t);
  const StatusIcon =
    tool.status === 'running' ? Spinner : tool.status === 'success' ? CheckCircle2Icon : XCircleIcon;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="overflow-hidden rounded-xl border bg-card">
      <CollapsibleTrigger
        title={tool.name}
        className="group flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="flex size-6 items-center justify-center rounded-sm bg-accent text-accent-foreground">
          {ToolIcon === undefined ? null : <ToolIcon className="size-4" />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-accent-foreground font-geist">
            {customToolLabel(t, tool.name) ?? renderer.label?.[tool.name] ?? tool.name}
          </span>
          {summary === undefined ? null : (
            <span className="truncate text-xs text-muted-foreground">{summary}</span>
          )}
        </span>
        <Badge
          variant={tool.status === 'error' ? 'destructive' : 'secondary'}
          className={cn(tool.status === 'success' && 'bg-success text-muted')}
        >
          <StatusIcon data-icon="inline-start" />
          {toolStatusLabel(t, tool.status)}
        </Badge>
        <ChevronDownIcon className="size-4 text-muted-foreground group-data-panel-open:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent keepMounted={false} className="border-t">
        {open ? (
          <div className="p-4">
            <Renderer tool={tool} />
          </div>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}
