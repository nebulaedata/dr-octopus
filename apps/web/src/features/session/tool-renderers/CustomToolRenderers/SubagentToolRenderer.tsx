/**
 * @author Codex
 * @description Renders pi-subagents live progress and terminal child results from structured ToolProjection details.
 */

import {
  CheckCircle2Icon,
  CircleIcon,
  LoaderCircleIcon,
  PauseCircleIcon,
  SquareIcon,
  UnplugIcon,
  XCircleIcon,
} from 'lucide-react';
import { Badge } from '@octopus/ui/components/badge';
import { Separator } from '@octopus/ui/components/separator';
import { SubagentAvatar } from '@/features/session/SubagentAvatar';
import { SubagentStatusBadge } from '@/features/session/SubagentStatusBadge';
import { ElapsedOdometer } from '@octopus/custom-ui/components/elapsed-time';
import { useI18n } from '@/i18n/use-i18n';
import { ToolContent, ToolSection } from '../ToolRendererParts';
import { formatToolValue } from '../tool-renderer-utils';
import { projectSubagentDetails } from './subagent-projection';
import type { SubagentChildProjection } from './subagent-projection';
import type { ToolRendererProps } from '../types';
import type { Translate } from '@/i18n/use-i18n';

/**
 * Localizes the Subagent child state machine while preserving unknown upstream states verbatim.
 */
function subagentStatusLabel(t: Translate, status: SubagentChildProjection['status']): string {
  return (
    {
      pending: t('session.subagentTool.status.pending', 'pending'),
      running: t('session.subagentTool.status.running', 'running'),
      completed: t('session.subagentTool.status.completed', 'completed'),
      failed: t('session.subagentTool.status.failed', 'failed'),
      paused: t('session.subagentTool.status.paused', 'paused'),
      stopped: t('session.subagentTool.status.stopped', 'stopped'),
      detached: t('session.subagentTool.status.detached', 'detached'),
    }[status] ?? status
  );
}

/**
 * Renders one Subagent tool call while preserving text output as a fallback section.
 */
export function SubagentToolRenderer({ tool }: ToolRendererProps) {
  const { t } = useI18n();
  const projection = projectSubagentDetails(tool);
  return (
    <div className="flex flex-col gap-3">
      <ToolSection title={t('session.subagentTool.run', 'Run')}>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {projection.mode === undefined ? null : <Badge variant="outline">{projection.mode}</Badge>}
          {projection.background ? <Badge variant="secondary">{'background'}</Badge> : null}
          {projection.runId === undefined ? null : (
            <span className="truncate font-mono text-xs text-muted-foreground">{projection.runId}</span>
          )}
        </div>
      </ToolSection>
      {projection.children.length === 0 ? null : (
        <>
          <Separator />
          <ToolSection title={t('session.subagentTool.agents', 'Agents')}>
            <div className="flex flex-col gap-2">
              {projection.children.map((child) => (
                <SubagentChildRow key={child.index} child={child} toolId={tool.id} />
              ))}
            </div>
          </ToolSection>
        </>
      )}
      {tool.content.length === 0 ? null : (
        <>
          <Separator />
          <ToolSection title={t('session.schedulerTool.statusTitle.output', 'Output')}>
            <ToolContent blocks={tool.content} />
          </ToolSection>
        </>
      )}
    </div>
  );
}

/**
 * Renders one child identity on a single fixed-height line so live activity cannot change row height.
 */
function SubagentChildRow({ child, toolId }: { child: SubagentChildProjection; toolId: string }) {
  const { t } = useI18n();
  return (
    <section className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex min-w-0 items-center gap-2">
        <SubagentAvatar seed={JSON.stringify([toolId, child.index])} />
        <span className="max-w-40 min-w-0 truncate text-sm font-medium" title={child.agent}>
          {child.agent}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={child.task}>
          {child.task}
        </span>
        {child.status !== 'running' || child.currentTool === undefined ? null : (
          <span
            className="hidden max-w-48 shrink-0 truncate text-xs text-muted-foreground sm:inline"
            title={t('session.subagentTool.currentTool', 'Current: {{tool}}', { tool: child.currentTool })}
          >
            {t('session.subagentTool.currentTool', 'Current: {{tool}}', { tool: child.currentTool })}
          </span>
        )}
        {child.tokens === undefined ? null : (
          <span className="hidden shrink-0 text-xs text-muted-foreground tabular-nums sm:inline">
            {t('session.subagentTool.tokens', '{{count}} tokens', { count: child.tokens })}
          </span>
        )}
        {child.durationMs === undefined ? null : (
          <ElapsedOdometer
            elapsedMs={child.durationMs}
            running={child.status === 'running'}
            className="shrink-0 text-xs text-muted-foreground"
          />
        )}
        <SubagentStatusBadge state={child.status}>
          <SubagentStatusIcon status={child.status} />
          {subagentStatusLabel(t, child.status)}
        </SubagentStatusBadge>
      </div>
      {child.error === undefined ? null : (
        <pre className="max-h-32 overflow-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap text-destructive">
          {formatToolValue(child.error)}
        </pre>
      )}
      {child.output === undefined ? null : (
        <pre className="max-h-40 overflow-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap">
          {formatToolValue(child.output)}
        </pre>
      )}
    </section>
  );
}

/**
 * Renders a status icon without leaking extension state into the shared ToolCard shell.
 */
function SubagentStatusIcon({ status }: { status: SubagentChildProjection['status'] }) {
  if (status === 'running') {
    return <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />;
  }
  if (status === 'completed') {
    return <CheckCircle2Icon data-icon="inline-start" />;
  }
  if (status === 'failed') {
    return <XCircleIcon data-icon="inline-start" />;
  }
  if (status === 'paused') {
    return <PauseCircleIcon data-icon="inline-start" />;
  }
  if (status === 'stopped') {
    return <SquareIcon data-icon="inline-start" />;
  }
  if (status === 'detached') {
    return <UnplugIcon data-icon="inline-start" />;
  }
  return <CircleIcon data-icon="inline-start" />;
}
