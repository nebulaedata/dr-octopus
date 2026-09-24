/**
 * @author Codex
 * @description Displays a globally paginated flat task catalog with workspace metadata.
 */
import { formatDateTime } from '@/utils/date';
import { ScheduleAuthorization } from './ScheduleAuthorization';
import { ScheduleArchiveActions } from './ScheduleArchiveActions';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ScheduleTaskStatusBadge } from './ScheduleTaskStatusBadge';
import { Button } from '@octopus/ui/components/button';
import { Empty, EmptyHeader, EmptyDescription } from '@octopus/ui/components/empty';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@octopus/ui/components/card';
import {
  ArchiveIcon,
  ArrowUpRightIcon,
  CalendarClockIcon,
  Clock3Icon,
  FolderIcon,
  HistoryIcon,
  LoaderCircleIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  TimerIcon,
} from 'lucide-react';
import { getScheduledTaskCatalog } from '@/api/scheduled-tasks';
import { SchedulePagination } from './SchedulePagination';
import { useI18n } from '@/i18n/use-i18n';
import type { ScheduleMutationInput } from '@/api/scheduled-tasks';
import type { ScheduledTask, ScheduledTaskQuery } from '@octopus/shared/protocol/scheduled-tasks';
import type { WorkspaceDto } from '@octopus/shared/protocol';
import type { Translate } from '@/i18n/use-i18n';

/**
 * Formats explicit UTC timestamps in the viewer's locale.
 */
function scheduleTime(value: string | null): string {
  return value ? formatDateTime(value) : '—';
}

/**
 * Keeps interval units and Cron timezone visible in the task catalog.
 */
function describeSchedule(t: Translate, task: ScheduledTask): string {
  const schedule = task.schedule;
  if (schedule.type === 'once') {
    return t('schedules.taskList.scheduleOnce', 'One-time · {{at}}', { at: scheduleTime(schedule.at) });
  }
  if (schedule.type === 'interval') {
    return t('schedules.taskList.scheduleInterval', 'Every {{minutes}} minutes · anchor {{anchor}}', {
      minutes: schedule.everyMs / 60_000,
      anchor: scheduleTime(schedule.anchorAt),
    });
  }
  return `${schedule.expression} · ${schedule.timezone}`;
}

/**
 * Filter before global pagination, retaining task actions in each card.
 */
export function ScheduleTaskList({
  workspaces,
  workspaceId,
  status,
  search,
  selectedTaskId,
  mutating,
  onAction,
  onEdit,
  onSelectHistory,
}: {
  workspaces: WorkspaceDto[];
  workspaceId: string;
  status: ScheduledTaskQuery['status'];
  search: string;
  selectedTaskId?: string;
  mutating: boolean;
  onAction(workspaceId: string, input: Omit<ScheduleMutationInput, 'key'>): void;
  onEdit(workspaceId: string, task: ScheduledTask): void;
  onSelectHistory(workspaceId: string, taskId: string): void;
}) {
  const [offset, setOffset] = useState(0);
  const { t } = useI18n();
  const tasks = useQuery({
    queryKey: ['scheduled-tasks', 'catalog', workspaceId, status, search, offset],
    queryFn: ({ signal }) =>
      getScheduledTaskCatalog(
        { ...(workspaceId ? { workspaceId } : {}), offset, limit: 21, status, q: search },
        signal
      ),
  });

  return (
    <section aria-label="Task list" className="flex flex-col gap-3">
      {tasks.error && (
        <p role="alert" className="py-3 text-sm text-destructive">
          {tasks.error.message}
        </p>
      )}
      {tasks.isPending && (
        <p role="status" className="py-3 text-sm text-muted-foreground">
          {t('schedules.taskList.loading', 'Loading tasks…')}
        </p>
      )}
      {tasks.data?.items.length === 0 && (
        <Empty className="border p-5">
          <EmptyHeader>
            <EmptyDescription>
              {t('schedules.taskList.empty', 'No matching tasks. Create a scheduled task in a session.')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <div className="flex flex-col gap-3">
        {tasks.data?.items.slice(0, 20).map((task) => {
          /**
           * Selects renderdt content in the existing condition order.
           */
          function renderScheduleDescription() {
            if (task.schedule.type === 'cron') {
              return t('schedules.taskList.cronSchedule', 'Cron schedule');
            } else if (task.schedule.type === 'interval') {
              return t('schedules.taskList.intervalSchedule', 'Interval schedule');
            } else {
              return t('schedules.taskList.onceSchedule', 'One-time task');
            }
          }
          return (
            <Card key={task.id} role="article" aria-label={task.name} size="sm">
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <CalendarClockIcon aria-hidden="true" className="size-4" />
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <CardTitle>
                      <h3 className="wrap-anywhere">{task.name}</h3>
                    </CardTitle>
                    <CardDescription className="flex min-w-0 items-center gap-1.5">
                      <FolderIcon aria-hidden="true" className="size-4 shrink-0 text-amber-500" />
                      <span className="wrap-anywhere font-geist">
                        {workspaces.find((workspace) => workspace.id === task.workspaceId)?.name ??
                          task.workspaceId}
                      </span>
                    </CardDescription>
                  </div>
                </div>
                <ScheduleTaskStatusBadge task={task} />
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <dl className="grid gap-3 rounded-lg bg-muted/40 px-3 py-2.5 sm:grid-cols-2 sm:gap-4">
                  <div className="flex min-w-0 flex-col gap-1">
                    <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <TimerIcon aria-hidden="true" className="size-3.5" />
                      {renderScheduleDescription()}
                    </dt>
                    <dd className="wrap-anywhere text-sm tabular-nums font-geist">
                      {describeSchedule(t, task)}
                    </dd>
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock3Icon aria-hidden="true" className="size-3.5" />
                      {t('schedules.taskList.nextRun', 'Next run')}
                    </dt>
                    <dd className="text-sm tabular-nums font-geist">{scheduleTime(task.nextRunAt)}</dd>
                  </div>
                </dl>
                {!task.deletedAt && task.authorizationBlock && (
                  <p className="wrap-anywhere text-xs text-destructive">
                    {task.authorizationBlock === 'SCHEDULE_PERMISSION_DENIED'
                      ? t(
                          'schedules.taskList.permissionDenied',
                          'Execution was blocked by permission rules. Check the run records for the specific tools and reasons; re-authorization may not lift the restriction.'
                        )
                      : task.authorizationBlock}
                  </p>
                )}
              </CardContent>
              <CardFooter className="flex flex-wrap justify-between gap-2">
                {task.targetSessionId ? (
                  <Link
                    className="inline-flex items-center gap-1.5 rounded-sm text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                    to="/workspaces/$workspaceId/sessions/$sessionId"
                    params={{ workspaceId: task.workspaceId, sessionId: task.targetSessionId }}
                    search={{}}
                  >
                    {t('schedules.taskList.openSourceSession', 'Open source session')}
                    <ArrowUpRightIcon aria-hidden="true" className="size-3.5" />
                  </Link>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t(
                      'schedules.taskList.sourceSessionMissing',
                      'The source session is no longer in the current directory.'
                    )}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-1.5">
                  {!task.deletedAt && (
                    <>
                      <ScheduleAuthorization task={task} workspaceId={task.workspaceId} />
                      <Button
                        size="sm"
                        variant="default"
                        disabled={
                          mutating ||
                          !!task.hasActiveRun ||
                          !!task.pausedAt ||
                          !!task.authorizationBlock ||
                          !task.authorizationRef
                        }
                        onClick={() => onAction(task.workspaceId, { operation: 'run-now', taskId: task.id })}
                      >
                        {task.hasActiveRun ? (
                          <LoaderCircleIcon aria-hidden="true" className="motion-safe:animate-spin" />
                        ) : (
                          <PlayIcon aria-hidden="true" />
                        )}
                        {task.hasActiveRun
                          ? t('schedules.taskList.running', 'Running…')
                          : t('schedules.taskList.runNow', 'Run now')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={mutating}
                        title={t(
                          'schedules.taskList.pauseTitle',
                          'Pausing the schedule only stops future runs; it does not stop the current run'
                        )}
                        onClick={() =>
                          onAction(task.workspaceId, {
                            operation: 'update',
                            taskId: task.id,
                            revision: task.revision,
                            input: { enabled: !!task.pausedAt },
                          })
                        }
                      >
                        {task.pausedAt ? <PlayIcon aria-hidden="true" /> : <PauseIcon aria-hidden="true" />}
                        {task.pausedAt
                          ? t('schedules.taskList.resumeSchedule', 'Resume schedule')
                          : t('schedules.taskList.pauseSchedule', 'Pause schedule')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={mutating}
                        onClick={() => onEdit(task.workspaceId, task)}
                      >
                        <PencilIcon aria-hidden="true" />
                        {t('common.edit', 'Edit')}
                      </Button>
                    </>
                  )}
                  <Button
                    size="sm"
                    variant={selectedTaskId === task.id ? 'secondary' : 'ghost'}
                    onClick={() => onSelectHistory(task.workspaceId, task.id)}
                  >
                    <HistoryIcon aria-hidden="true" />
                    {t('schedules.taskList.runRecords', 'Run records')}
                  </Button>
                  {!task.deletedAt && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={mutating}
                      onClick={() =>
                        onAction(task.workspaceId, {
                          operation: 'archive',
                          taskId: task.id,
                          revision: task.revision,
                        })
                      }
                    >
                      <ArchiveIcon aria-hidden="true" />
                      {t('schedules.taskList.archive', 'Archive')}
                    </Button>
                  )}
                  {task.deletedAt && <ScheduleArchiveActions task={task} />}
                </div>
              </CardFooter>
            </Card>
          );
        })}
      </div>
      <SchedulePagination
        offset={offset}
        hasMore={(tasks.data?.items.length ?? 0) > 20}
        pending={tasks.isFetching}
        onChange={setOffset}
      />
    </section>
  );
}
