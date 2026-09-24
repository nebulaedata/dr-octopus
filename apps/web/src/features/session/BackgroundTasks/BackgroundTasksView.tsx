/**
 * @author Codex
 * @description Provides a quiet composer summary and a responsive, accessible task drawer.
 */
import { useEffect, useId, useRef } from 'react';
import { useSafeState } from 'ahooks';
import { ChevronRightIcon, LayersIcon, LoaderCircleIcon, ShieldAlertIcon, SquareIcon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import { Alert, AlertDescription, AlertTitle } from '@octopus/ui/components/alert';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetTrigger,
} from '@octopus/ui/components/sheet';
import { cn } from '@octopus/ui/lib/utils';
import { isBackgroundTaskActive } from '@octopus/shared/protocol';
import { useI18n } from '@/i18n/use-i18n';
import { useBackgroundTasksStore } from '@/stores/background-tasks';
import { BackgroundTaskRow } from './BackgroundTaskRow';
import { BackgroundTaskLogs } from './BackgroundTaskLogs';
import { describeBackgroundTask } from '@/features/session/utils/task-presentation';
import type { BackgroundTaskAction } from '@/features/session/hooks/use-background-task-control';
import type { BackgroundTasksSnapshot } from '@octopus/shared/protocol';

interface BackgroundTasksViewProps {
  sessionId: string;
  snapshot?: BackgroundTasksSnapshot | null;
  /**
   * Resolves after authoritative action evidence; rejects unavailable or stale controls.
   */
  onAction(action: BackgroundTaskAction, taskId?: string): Promise<void>;
}

/**
 * Leaves conversation space available until the user explicitly opens process details.
 */
export function BackgroundTasksView({ sessionId, snapshot, onAction }: BackgroundTasksViewProps) {
  const { t } = useI18n();
  const [open, setOpen] = useSafeState(false);
  const [selected, setSelected] = useSafeState<string>();
  const [pending, setPending] = useSafeState<string>();
  const [error, setError] = useSafeState<string>();
  const dismissedSnapshot = useBackgroundTasksStore((state) => state.dismissedSnapshots[sessionId]);
  const dismissSnapshot = useBackgroundTasksStore((state) => state.dismissSnapshot);
  const clearDismissedSnapshot = useBackgroundTasksStore((state) => state.clearDismissedSnapshot);
  const locked = useRef(false);
  const logId = useId();
  const snapshotKey = snapshot ? `${snapshot.generation}:${snapshot.revision}` : undefined;
  const hasActiveTask = snapshot?.tasks.some(isBackgroundTaskActive) ?? false;
  useEffect(() => {
    if (hasActiveTask) {
      clearDismissedSnapshot(sessionId);
    }
  }, [clearDismissedSnapshot, hasActiveTask, sessionId]);
  if (
    snapshot === undefined ||
    (snapshot?.tasks.length === 0 && snapshot.accepting) ||
    (snapshotKey !== undefined && snapshotKey === dismissedSnapshot)
  ) {
    return null;
  }
  const tasks = snapshot?.tasks ?? [];
  const active = tasks.filter(isBackgroundTaskActive);
  const recent = tasks
    .filter((task) => !isBackgroundTaskActive(task))
    .slice()
    .sort((a, b) => (b.endedAt ?? b.createdAt) - (a.endedAt ?? a.createdAt));
  const blocked = snapshot === null || !snapshot.accepting;
  const failedCount = tasks.filter((task) => describeBackgroundTask(t, task).failed).length;
  const needsAttention =
    blocked ||
    active.some((task) => describeBackgroundTask(t, task).failed) ||
    (active.length === 0 && failedCount > 0);
  let summary: string;
  if (snapshot === null) {
    summary = t('session.backgroundTasks.summary.pending', 'Status pending confirmation');
  } else if (!snapshot.accepting) {
    summary = t('session.backgroundTasks.summary.stopping', 'Stop pending confirmation');
  } else if (active.length) {
    summary = t('session.backgroundTasks.summary.active', '{{count}} running', { count: active.length });
  } else if (failedCount) {
    summary = t('session.backgroundTasks.summary.failed', '{{count}} tasks failed', { count: failedCount });
  } else {
    summary = t('session.backgroundTasks.summary.recent', '{{count}} finished', { count: recent.length });
  }

  /**
   * Locks before dispatch so repeated clicks cannot issue duplicate destructive controls.
   */
  async function act(action: BackgroundTaskAction, taskId?: string): Promise<void> {
    if (locked.current) {
      return;
    }
    locked.current = true;
    setPending(`${action}:${taskId ?? ''}`);
    setError(undefined);
    try {
      await onAction(action, taskId);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('session.backgroundTasks.actionFailed', 'Action did not complete. Please try again.')
      );
    } finally {
      locked.current = false;
      setPending(undefined);
    }
  }

  /**
   * Expands one task at a time and fetches its output only on demand.
   */
  function toggleLogs(taskId: string): void {
    if (selected === taskId) {
      setSelected(undefined);
      return;
    }
    if (locked.current) {
      return;
    }
    setSelected(taskId);
    void act('logs', taskId);
  }

  /**
   * Hides the settled snapshot while allowing a later task revision to surface again.
   */
  function dismiss(): void {
    if (!snapshot || active.length > 0 || !snapshot.accepting) {
      return;
    }
    setOpen(false);
    dismissSnapshot(sessionId, `${snapshot.generation}:${snapshot.revision}`);
  }

  /**
   * Selects button content in the existing condition order.
   */
  function renderButtonContent() {
    if (pending === 'all:') {
      return t('session.backgroundTasks.stoppingButton', 'Stopping…');
    } else if (blocked) {
      return t('session.backgroundTasks.retryStop', 'Retry stop');
    } else {
      return t('session.backgroundTasks.stopAll', 'Stop all');
    }
  }
  /**
   * Selects alert description content in the existing condition order.
   */
  function renderAlertDescriptionContent(currentSnapshot: NonNullable<typeof snapshot> | null) {
    if (currentSnapshot === null) {
      return t(
        'session.backgroundTasks.alert.unreadable',
        'Unable to read task status right now. Retry stopping to confirm all tasks have exited.'
      );
    } else if (currentSnapshot.error) {
      return t(
        'session.backgroundTasks.alert.incomplete',
        'Background task operation did not complete; check task status and retry.'
      );
    } else {
      return t(
        'session.backgroundTasks.alert.confirming',
        'Confirming process exit; new tasks cannot start until this completes.'
      );
    }
  }
  /**
   * Selects alert title content in the existing condition order.
   */
  function renderAlertTitleContent() {
    if (error) {
      return t('session.backgroundTasks.alert.actionIncomplete', 'Action incomplete');
    } else if (pending === 'all:') {
      return t('session.backgroundTasks.alert.stopping', 'Stopping tasks');
    } else {
      return t('session.backgroundTasks.alert.stopUnconfirmed', 'Stop not yet confirmed');
    }
  }
  /**
   * Selects class name in the existing condition order.
   */
  function selectClassName() {
    if (needsAttention) {
      return 'bg-destructive' as const;
    } else if (active.length) {
      return 'bg-primary' as const;
    } else {
      return 'bg-muted-foreground/50' as const;
    }
  }
  return (
    <section
      aria-label="Background processes"
      className="mx-auto w-[calc(100%-20px)] shrink-0 sm:w-[min(calc(100%-32px),880px)]"
    >
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          render={<Button variant="ghost" className="max-w-full justify-start gap-2.5" />}
          aria-label={`Background tasks, ${summary}, open management panel`}
        >
          <LayersIcon data-icon="inline-start" />
          <span>{t('session.backgroundTasks.title', 'Background tasks')}</span>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 text-xs',
              needsAttention ? 'text-destructive' : 'text-muted-foreground'
            )}
          >
            <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', selectClassName())} />
            {summary}
          </span>
          <ChevronRightIcon data-icon="inline-end" className="text-muted-foreground" />
        </SheetTrigger>
        <SheetContent
          side="right"
          className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-120 motion-reduce:transition-none"
        >
          <SheetHeader className="gap-2 border-b px-5 pb-5 pt-6 sm:px-6">
            <SheetTitle>
              <div className="flex items-center gap-2">
                <LayersIcon className="size-5 text-primary" />
                {t('session.backgroundTasks.title', 'Background tasks')}
              </div>
            </SheetTitle>
            <SheetDescription>
              {t(
                'session.backgroundTasks.description',
                "View this session's running processes and recent output."
              )}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-5">
            {(snapshot === null || !snapshot.accepting || error || snapshot.error) && (
              <Alert
                variant={error || snapshot === null || snapshot?.error ? 'destructive' : 'default'}
                className="mb-5"
              >
                <ShieldAlertIcon />
                <AlertTitle>{renderAlertTitleContent()}</AlertTitle>
                <AlertDescription>{error ?? renderAlertDescriptionContent(snapshot)}</AlertDescription>
              </Alert>
            )}
            {[
              { title: t('session.backgroundTasks.groupRunning', 'Running'), items: active },
              { title: t('session.backgroundTasks.groupRecent', 'Recently finished'), items: recent },
            ]
              .filter((group) => group.items.length)
              .map((group) => (
                <section key={group.title} aria-label={group.title} className="mb-6 last:mb-0">
                  <div className="mb-2.5 flex items-center gap-2 px-1 text-xs font-medium text-muted-foreground">
                    <h3>{group.title}</h3>
                    <span className="tabular-nums">{group.items.length}</span>
                  </div>
                  <div className="overflow-hidden rounded-xl border bg-card">
                    {group.items.map((task) => (
                      <div key={task.taskId} className="border-b last:border-b-0">
                        <BackgroundTaskRow
                          task={task}
                          expanded={selected === task.taskId}
                          pending={pending}
                          blocked={blocked}
                          logId={logId}
                          onLogs={() => toggleLogs(task.taskId)}
                          onStop={() => void act('stop', task.taskId)}
                        />
                        {selected === task.taskId && (
                          <BackgroundTaskLogs
                            id={logId}
                            logs={snapshot?.logs?.taskId === task.taskId ? snapshot.logs : undefined}
                            loading={pending === `logs:${task.taskId}`}
                            disabled={Boolean(pending) || blocked}
                            onRefresh={() => void act('logs', task.taskId)}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            {snapshot && tasks.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t('session.backgroundTasks.empty', 'No background tasks right now')}
              </p>
            )}
          </div>
          <SheetFooter className="gap-3 border-t bg-muted/20 px-5 py-3 sm:px-6 sm:py-4">
            {active.length > 0 || blocked ? (
              <>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t(
                    'session.backgroundTasks.stopAllNote',
                    'Stopping all also aborts the current Agent run; generated content is kept.'
                  )}
                </p>
                <Button variant="destructive" disabled={Boolean(pending)} onClick={() => void act('all')}>
                  {pending === 'all:' ? (
                    <LoaderCircleIcon data-icon="inline-start" className="motion-safe:animate-spin" />
                  ) : (
                    <SquareIcon data-icon="inline-start" className="text-destructive" />
                  )}
                  {renderButtonContent()}
                </Button>
              </>
            ) : (
              <div className="flex justify-between">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-muted-foreground/50" />
                  {t('session.backgroundTasks.allFinished', 'All background tasks have finished')}
                </div>
                <Button variant="destructive" onClick={dismiss}>
                  {t('common.close', 'Close')}
                </Button>
              </div>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </section>
  );
}
