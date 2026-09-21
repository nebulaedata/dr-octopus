/**
 * @author Codex
 * @description Presents the current Session's versioned pi-subagents Fleet snapshot above the Composer.
 */

import {
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleIcon,
  LoaderCircleIcon,
  NetworkIcon,
  PauseCircleIcon,
  XCircleIcon,
} from 'lucide-react';
import { useStore } from 'zustand';
import { Badge } from '@octopus/ui/components/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@octopus/ui/components/collapsible';
import { ElapsedOdometer } from '@octopus/custom-ui/components/elapsed-time';
import { sessionStores } from '@/stores/session';
import { useI18n } from '@/i18n/use-i18n';
import { SubagentAvatar } from './SubagentAvatar';
import { SubagentStatusBadge } from './SubagentStatusBadge';
import type { SubagentFleetNodeDto, SubagentFleetNodeState } from '@octopus/shared/protocol';

const ACTIVE_STATES = new Set<SubagentFleetNodeState>(['queued', 'running']);

/**
 * Renders the latest live Fleet snapshot and stays absent when the extension has no visible runs.
 */
export function SubagentFleetPanel({ sessionId }: { sessionId: string }) {
  const { t } = useI18n();
  const store = sessionStores.ensure(sessionId);
  const snapshot = useStore(store, (state) => state.subagentFleet);
  if (snapshot === undefined || snapshot.runs.length === 0) {
    return null;
  }
  const activeCount = countActiveLeaves(snapshot.runs);
  return (
    <div className="mx-auto w-[calc(100%-20px)] sm:w-[min(calc(100%-32px),880px)]">
      <Collapsible defaultOpen className="overflow-hidden rounded-xl border bg-card">
        <CollapsibleTrigger className="group flex w-full items-center gap-3 px-4 py-3 text-left">
          <NetworkIcon className="size-4 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {t('session.fleetPanel.title', 'Subagents background')}
          </span>
          <Badge variant={activeCount > 0 ? 'secondary' : 'outline'}>
            {activeCount > 0
              ? t('session.fleetPanel.badgeActive', '{{count}} active', { count: activeCount })
              : t('session.fleetPanel.badgeRecent', 'Recent')}
          </Badge>
          <ChevronDownIcon className="size-4 text-muted-foreground group-data-panel-open:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t">
          <div className="flex max-h-72 flex-col gap-2 overflow-auto p-3">
            {snapshot.runs.map((run) => (
              <FleetNodeRow
                key={run.id}
                sessionId={sessionId}
                generatedAt={snapshot.generatedAt}
                node={run}
              />
            ))}
            {snapshot.omitted.runs + snapshot.omitted.children === 0 &&
            !snapshot.omitted.byteLimitExceeded ? null : (
              <p className="text-xs text-muted-foreground">
                {snapshot.omitted.byteLimitExceeded
                  ? t(
                      'session.fleetPanel.omittedTruncated',
                      'Additional agent state was truncated to the transport limit.'
                    )
                  : t('session.fleetPanel.omittedCount', '{{count}} additional items omitted.', {
                      count: snapshot.omitted.runs + snapshot.omitted.children,
                    })}
              </p>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/**
 * Renders one workflow or agent node on a fixed-height line and recursively displays its bounded children.
 */
function FleetNodeRow({
  generatedAt,
  node,
  sessionId,
}: {
  generatedAt: number;
  node: SubagentFleetNodeDto;
  sessionId: string;
}) {
  const { t } = useI18n();
  const duration = resolveNodeDuration(node, generatedAt);
  const currentTool = node.activity?.currentTool;
  return (
    <section className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex min-w-0 items-center gap-2">
        {node.kind === 'workflow' ? null : <SubagentAvatar seed={JSON.stringify([sessionId, node.id])} />}
        <span className="max-w-40 min-w-0 truncate text-sm font-medium" title={node.label}>
          {node.label}
        </span>
        <span
          className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
          title={
            currentTool === undefined
              ? undefined
              : t('session.subagentTool.currentTool', 'Current: {{tool}}', { tool: currentTool })
          }
        >
          {currentTool === undefined
            ? ''
            : t('session.subagentTool.currentTool', 'Current: {{tool}}', { tool: currentTool })}
        </span>
        {duration === undefined ? null : (
          <ElapsedOdometer
            elapsedMs={duration}
            running={ACTIVE_STATES.has(node.state)}
            className="shrink-0 text-xs text-muted-foreground"
          />
        )}
        <SubagentStatusBadge state={node.state}>
          <FleetStatusIcon state={node.state} />
          {node.state}
        </SubagentStatusBadge>
      </div>
      {node.children === undefined || node.children.length === 0 ? null : (
        <div className="flex flex-col gap-2 border-l pl-3 pt-1.5">
          {node.children.map((child) => (
            <FleetNodeRow key={child.id} sessionId={sessionId} generatedAt={generatedAt} node={child} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Counts active leaf agents without double-counting their workflow containers.
 */
function countActiveLeaves(nodes: SubagentFleetNodeDto[]): number {
  return nodes.reduce((total, node) => {
    if (node.children !== undefined && node.children.length > 0) {
      return total + countActiveLeaves(node.children);
    }
    return total + (ACTIVE_STATES.has(node.state) ? 1 : 0);
  }, 0);
}

/**
 * Resolves one node's bounded elapsed duration from snapshot timestamps.
 */
function resolveNodeDuration(node: SubagentFleetNodeDto, generatedAt: number): number | undefined {
  return node.startedAt === undefined
    ? undefined
    : Math.max(0, (node.endedAt ?? node.updatedAt ?? generatedAt) - node.startedAt);
}

/**
 * Renders the icon corresponding to one Fleet state.
 */
function FleetStatusIcon({ state }: { state: SubagentFleetNodeState }) {
  if (state === 'running') {
    return <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />;
  }
  if (state === 'complete') {
    return <CheckCircle2Icon data-icon="inline-start" />;
  }
  if (state === 'failed' || state === 'rejected') {
    return <XCircleIcon data-icon="inline-start" />;
  }
  if (state === 'paused' || state === 'partial') {
    return <PauseCircleIcon data-icon="inline-start" />;
  }
  return <CircleIcon data-icon="inline-start" />;
}
