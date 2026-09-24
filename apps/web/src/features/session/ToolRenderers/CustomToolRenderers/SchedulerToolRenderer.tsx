/**
 * @author Codex
 * @description Renders Agent Scheduler tools as calendar-themed task and run cards.
 */

import { formatDateTime } from '@/utils/date';
import {
  AlarmClockIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  Clock3Icon,
  PlayIcon,
  Repeat2Icon,
} from 'lucide-react';
import { Badge } from '@octopus/ui/components/badge';
import { Separator } from '@octopus/ui/components/separator';
import { useI18n } from '@/i18n/use-i18n';
import { ToolContent, ToolSection } from '../ToolRendererParts';
import { projectSchedulerTool } from '@/features/session/utils/scheduler-projection';
import { SchedulerAuthorizationLink } from './SchedulerAuthorizationLink';
import type {
  SchedulerRunProjection,
  SchedulerScheduleProjection,
  SchedulerTaskProjection,
} from '@/features/session/utils/scheduler-projection';
import type { ToolRendererProps } from '../ToolRendererParts';
import type { Translate } from '@/i18n/use-i18n';

/**
 * Maps Scheduler tool names to card titles in the active locale.
 */
function schedulerToolTitle(t: Translate, name: string): string {
  return (
    {
      scheduler_create: t('session.schedulerTool.title.create', 'Create scheduled task'),
      scheduler_list: t('session.schedulerTool.title.list', 'Scheduled task list'),
      scheduler_get: t('session.schedulerTool.title.get', 'Scheduled task details'),
      scheduler_update: t('session.schedulerTool.title.update', 'Update scheduled task'),
      scheduler_delete: t('session.schedulerTool.title.delete', 'Delete scheduled task'),
      scheduler_run_now: t('session.schedulerTool.title.runNow', 'Run task now'),
      scheduler_cancel: t('session.schedulerTool.title.cancel', 'Cancel task run'),
      scheduler_history: t('session.schedulerTool.title.history', 'Task run history'),
    }[name] ?? t('session.schedulerTool.title.fallback', 'Scheduled task')
  );
}

/**
 * Presents Scheduler task state, timing and execution results from structured details.
 */
export function SchedulerToolRenderer({ tool }: ToolRendererProps) {
  const { t } = useI18n();
  const projection = projectSchedulerTool(t, tool);
  const hasStructuredResult =
    projection.task !== undefined ||
    projection.tasks.length > 0 ||
    projection.run !== undefined ||
    projection.runs.length > 0 ||
    projection.effect !== undefined;
  /**
   * Selects title in the existing condition order.
   */
  function selectTitle() {
    if (tool.status === 'error') {
      return t('session.schedulerTool.statusTitle.error', 'Error');
    } else if (tool.status === 'running') {
      return t('session.schedulerTool.statusTitle.running', 'Processing');
    } else {
      return t('session.schedulerTool.statusTitle.output', 'Output');
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <section className="relative overflow-hidden rounded-xl border border-amber-500/20 bg-linear-to-br from-amber-500/12 via-background to-violet-500/10 p-4">
        <div className="absolute -top-8 -right-8 size-28 rounded-full bg-amber-400/10 blur-2xl" />
        <div className="relative flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-300">
            <CalendarClockIcon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="font-semibold">{schedulerToolTitle(t, tool.name)}</h4>
              {projection.effect === undefined ? null : <EffectBadge effect={projection.effect} />}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('session.schedulerTool.subtitle', 'Runs in an independent session · persisted by Scheduler')}
            </p>
          </div>
        </div>
      </section>

      {projection.task === undefined ? null : <TaskCard task={projection.task} />}
      {projection.tasks.length === 0 ? null : <TaskList tasks={projection.tasks} />}
      {projection.run === undefined ? null : <RunCard run={projection.run} />}
      {projection.runs.length === 0 ? null : <RunList runs={projection.runs} />}

      {projection.warnings.length === 0 ? null : (
        <>
          <Separator />
          <ToolSection title={t('session.schedulerTool.warnings', 'Reminders')}>
            <div className="flex flex-col gap-1.5">
              {projection.warnings.map((warning) => (
                <p
                  key={warning}
                  className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300"
                >
                  <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
                  {warning}
                </p>
              ))}
              {tool.status === 'success' && (
                <div className="flex justify-center mt-2">
                  <SchedulerAuthorizationLink
                    className="max-w-40"
                    taskId={projection.task?.id ?? projection.requestedTaskId}
                  />
                </div>
              )}
            </div>
          </ToolSection>
        </>
      )}

      {(hasStructuredResult && tool.status !== 'error') || tool.content.length === 0 ? null : (
        <ToolSection title={selectTitle()}>
          <ToolContent blocks={tool.content} />
        </ToolSection>
      )}
    </div>
  );
}

/**
 * Renders one task with schedule, next-run and prompt context.
 */
function TaskCard({ task }: { task: SchedulerTaskProjection }) {
  const { t } = useI18n();
  return (
    <section className="rounded-xl border bg-card/60 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate font-medium">
            {task.name ?? t('session.schedulerTool.unnamedTask', 'Unnamed task')}
          </h4>
          {task.description === undefined ? null : (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{task.description}</p>
          )}
        </div>
        <TaskStateBadge task={task} />
      </div>
      {task.schedule === undefined ? null : <ScheduleLine schedule={task.schedule} />}
      {task.nextRunAt === undefined ? null : (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs">
          <AlarmClockIcon className="size-4 text-amber-600" />
          <span className="text-muted-foreground">{t('session.schedulerTool.nextRun', 'Next run')}</span>
          <span className="font-medium">{formatDate(task.nextRunAt)}</span>
        </div>
      )}
      {task.prompt === undefined ? null : (
        <p className="mt-3 line-clamp-3 rounded-lg border border-dashed px-3 py-2 text-xs whitespace-pre-wrap text-muted-foreground">
          {task.prompt}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
        {task.id === undefined ? null : <span className="truncate">{task.id}</span>}
        {task.revision === undefined ? null : (
          <span>
            {'rev '}
            {task.revision}
          </span>
        )}
      </div>
    </section>
  );
}

/**
 * Renders a bounded catalog without expanding raw JSON.
 */
function TaskList({ tasks }: { tasks: SchedulerTaskProjection[] }) {
  const { t } = useI18n();
  return (
    <ToolSection title={t('session.schedulerTool.taskCount', '{{count}} tasks', { count: tasks.length })}>
      <div className="grid gap-2 sm:grid-cols-2">
        {tasks.slice(0, 10).map((task, index) => (
          <div key={task.id ?? `${task.name ?? 'task'}-${String(index)}`} className="rounded-lg border p-3">
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-medium">
                {task.name ?? t('session.schedulerTool.unnamedTask', 'Unnamed task')}
              </span>
              <TaskStateBadge task={task} />
            </div>
            {task.schedule === undefined ? null : <ScheduleLine schedule={task.schedule} compact />}
            {task.nextRunAt === undefined ? null : (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {t('session.schedulerTool.nextRunShort', 'Next: {{date}}', {
                  date: formatDate(task.nextRunAt),
                })}
              </p>
            )}
          </div>
        ))}
      </div>
      {tasks.length <= 10 ? null : (
        <p className="text-xs text-muted-foreground">
          {t('session.schedulerTool.moreTasks', '{{count}} more tasks not expanded', {
            count: tasks.length - 10,
          })}
        </p>
      )}
    </ToolSection>
  );
}

/**
 * Renders the run emitted by a mutation such as run-now or cancel.
 */
function RunCard({ run }: { run: SchedulerRunProjection }) {
  const { t } = useI18n();
  return (
    <ToolSection title={t('session.schedulerTool.thisRun', 'This run')}>
      <RunRow run={run} />
    </ToolSection>
  );
}

/**
 * Renders recent runs as a compact vertical timeline.
 */
function RunList({ runs }: { runs: SchedulerRunProjection[] }) {
  const { t } = useI18n();
  return (
    <ToolSection title={t('session.schedulerTool.runCount', '{{count}} run records', { count: runs.length })}>
      <div className="relative ml-2 flex flex-col gap-3 border-l pl-4">
        {runs.slice(0, 12).map((run, index) => (
          <div key={run.id ?? `${run.status ?? 'run'}-${String(index)}`} className="relative">
            <span className="absolute top-2 -left-[1.34rem] size-2 rounded-full bg-amber-500 ring-4 ring-background" />
            <RunRow run={run} />
          </div>
        ))}
      </div>
    </ToolSection>
  );
}

/**
 * Displays one run state with timing and a bounded summary.
 */
function RunRow({ run }: { run: SchedulerRunProjection }) {
  const { t } = useI18n();
  return (
    <div className="rounded-lg border bg-card/60 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <RunStatusBadge status={run.status} />
        {run.triggerSource === undefined ? null : (
          <Badge variant="outline">
            {run.triggerSource === 'manual'
              ? t('session.schedulerTool.triggerManual', 'Manual trigger')
              : t('session.schedulerTool.triggerScheduled', 'Scheduled trigger')}
          </Badge>
        )}
        {run.scheduledFor === undefined ? null : (
          <span className="ml-auto text-[11px] text-muted-foreground">{formatDate(run.scheduledFor)}</span>
        )}
      </div>
      {run.summary === undefined || run.summary === null ? null : (
        <p className="mt-2 line-clamp-4 text-xs whitespace-pre-wrap">{run.summary}</p>
      )}
      {run.errorCode === undefined || run.errorCode === null ? null : (
        <p className="mt-2 font-mono text-[11px] text-destructive">{run.errorCode}</p>
      )}
      {run.id === undefined ? null : (
        <p className="mt-2 truncate font-mono text-[10px] text-muted-foreground">{run.id}</p>
      )}
    </div>
  );
}

/**
 * Gives schedule variants recognizable calendar and repeat cues.
 */
function ScheduleLine({
  schedule,
  compact = false,
}: {
  schedule: SchedulerScheduleProjection;
  compact?: boolean;
}) {
  let Icon;
  if (schedule.type === 'interval') {
    Icon = Repeat2Icon;
  } else if (schedule.type === 'cron') {
    Icon = Clock3Icon;
  } else {
    Icon = CalendarClockIcon;
  }
  return (
    <div className={compact ? 'mt-2 flex items-start gap-2 text-xs' : 'mt-3 flex items-start gap-2 text-sm'}>
      <Icon className="mt-0.5 size-4 shrink-0 text-amber-600" />
      <div className="min-w-0">
        <p className="truncate font-medium">{schedule.primary}</p>
        {schedule.secondary === undefined ? null : (
          <p className="truncate text-xs text-muted-foreground">{formatMaybeDate(schedule.secondary)}</p>
        )}
      </div>
    </div>
  );
}

/**
 * Maps persisted task state to a concise semantic badge.
 */
function TaskStateBadge({ task }: { task: SchedulerTaskProjection }) {
  const { t } = useI18n();
  if (task.pausedAt) {
    return <Badge variant="warning">{t('session.schedulerTool.state.paused', 'Paused')}</Badge>;
  }
  if (task.enabled === true) {
    return (
      <Badge className="bg-emerald-600 text-white">
        {t('session.schedulerTool.state.enabled', 'Enabled')}
      </Badge>
    );
  }
  if (task.enabled === false) {
    return <Badge variant="secondary">{t('session.schedulerTool.state.completed', 'Completed')}</Badge>;
  }
  return <Badge variant="outline">{t('session.schedulerTool.state.task', 'Task')}</Badge>;
}

/**
 * Maps one Run status to localized text and semantic color.
 */
function RunStatusBadge({ status }: { status?: string }) {
  const { t } = useI18n();
  const success = status === 'succeeded';
  const attention = status === 'needs_attention' || status === 'timed_out';
  const failed = status === 'failed' || status === 'interrupted' || status === 'cancelled';
  /**
   * Selects badge content in the existing condition order.
   */
  function renderBadgeContent() {
    if (success) {
      return <CheckCircle2Icon data-icon="inline-start" />;
    } else if (status === 'running') {
      return <PlayIcon data-icon="inline-start" />;
    } else {
      return null;
    }
  }
  /**
   * Selects variant in the existing condition order.
   */
  function selectVariant() {
    if (failed) {
      return 'destructive' as const;
    } else if (attention) {
      return 'warning' as const;
    } else {
      return 'secondary' as const;
    }
  }
  return (
    <Badge variant={selectVariant()} className={success ? 'bg-emerald-600 text-white' : undefined}>
      {renderBadgeContent()}
      {runStatusLabel(t, status)}
    </Badge>
  );
}

/**
 * Localizes the stable Scheduler Run state machine.
 */
function runStatusLabel(t: Translate, status?: string): string {
  return (
    {
      queued: t('session.schedulerTool.runStatus.queued', 'Queued'),
      claimed: t('session.schedulerTool.runStatus.claimed', 'Claimed'),
      dispatching: t('session.schedulerTool.runStatus.dispatching', 'Dispatching'),
      running: t('session.schedulerTool.runStatus.running', 'Running'),
      succeeded: t('session.schedulerTool.runStatus.succeeded', 'Succeeded'),
      failed: t('session.schedulerTool.runStatus.failed', 'Failed'),
      needs_attention: t('session.schedulerTool.runStatus.needsAttention', 'Needs attention'),
      timed_out: t('session.schedulerTool.runStatus.timedOut', 'Timed out'),
      cancelled: t('session.schedulerTool.runStatus.cancelled', 'Cancelled'),
      interrupted: t('session.schedulerTool.runStatus.interrupted', 'Interrupted'),
      skipped: t('session.schedulerTool.runStatus.skipped', 'Skipped'),
    }[status ?? ''] ?? t('session.schedulerTool.runStatus.fallback', 'Run')
  );
}

/**
 * Renders mutation outcomes without exposing transport wording.
 */
function EffectBadge({ effect }: { effect: string }) {
  const { t } = useI18n();
  const label = effectLabel(t, effect);
  return <Badge variant="outline">{label}</Badge>;
}

/**
 * Localizes the Scheduler mutation effect labels.
 */
function effectLabel(t: Translate, effect: string): string {
  return (
    (
      {
        saved: t('session.schedulerTool.effect.saved', 'Saved'),
        queued: t('session.schedulerTool.effect.queued', 'Queued'),
        deleted: t('session.schedulerTool.effect.deleted', 'Deleted'),
        cancelled: t('session.schedulerTool.effect.cancelled', 'Cancelled'),
        cancellation_requested: t('session.schedulerTool.effect.cancellationRequested', 'Cancelling'),
      } as Record<string, string>
    )[effect] ?? effect
  );
}

/**
 * Formats nullable ISO timestamps in the viewer's locale.
 */
function formatDate(value: string | null): string {
  if (value === null) {
    return '—';
  }
  return formatDateTime(value);
}

/**
 * Formats ISO-looking schedule metadata while preserving IANA timezone labels.
 */
function formatMaybeDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}T/u.test(value) ? formatDate(value) : value;
}
