/**
 * @author Codex
 * @description Presents task identity, lifecycle and explicit log/stop controls in one readable row.
 */
import {
  ChevronDownIcon,
  CircleCheckIcon,
  CircleAlertIcon,
  LoaderCircleIcon,
  SquareIcon,
  TerminalIcon,
} from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import { cn } from '@octopus/ui/lib/utils';
import { isBackgroundTaskActive } from '@octopus/shared/protocol';
import { useI18n } from '@/i18n/use-i18n';
import { describeBackgroundTask } from '@/features/session/utils/task-presentation';
import type { BackgroundTaskDto } from '@octopus/shared/protocol';

interface BackgroundTaskRowProps {
  task: BackgroundTaskDto;
  expanded: boolean;
  pending?: string;
  blocked: boolean;
  logId: string;
  /**
   * Toggles this task's output without starting a new process.
   */
  onLogs(): void;
  /**
   * Requests verified termination of this task's process scope.
   */
  onStop(): void;
}

/**
 * Keeps task name first, readable state second and destructive action at the trailing edge.
 */
export function BackgroundTaskRow({
  task,
  expanded,
  pending,
  blocked,
  logId,
  onLogs,
  onStop,
}: BackgroundTaskRowProps) {
  const { t } = useI18n();
  const status = describeBackgroundTask(t, task);
  const active = isBackgroundTaskActive(task);
  const stopping = pending === `stop:${task.taskId}` || task.state === 'stopping';
  let Icon;
  if (status.failed) {
    Icon = CircleAlertIcon;
  } else if (status.busy) {
    Icon = LoaderCircleIcon;
  } else if (active) {
    Icon = TerminalIcon;
  } else {
    Icon = CircleCheckIcon;
  }
  /**
   * Selects class name in the existing condition order.
   */
  function selectClassName() {
    if (status.failed) {
      return 'bg-destructive/10 text-destructive' as const;
    } else if (active) {
      return 'bg-primary/10 text-primary' as const;
    } else {
      return 'bg-success/15 text-success' as const;
    }
  }
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', selectClassName())}>
        <Icon className={cn('size-4', status.busy && 'motion-safe:animate-spin')} aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 wrap-break-word text-sm font-medium" title={task.label}>
          {task.label}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span
            className={cn(
              'inline-flex items-center gap-1.5',
              status.failed && 'text-destructive',
              task.state === 'running' && 'text-primary'
            )}
          >
            {task.state === 'running' && (
              <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
            )}
            {status.label}
          </span>
          <span aria-hidden="true">·</span>
          <span>{t('session.backgroundTasks.row.started', 'Started {{time}}', { time: status.time })}</span>
          {status.failed && typeof task.exitCode === 'number' && (
            <span>
              {t('session.backgroundTasks.row.exitCode', 'Exit code {{code}}', { code: task.exitCode })}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={onLogs}
          disabled={blocked || (Boolean(pending) && !expanded)}
          aria-label={`${expanded ? 'Collapse' : 'View'} logs for ${task.label}`}
          aria-expanded={expanded}
          aria-controls={expanded ? logId : undefined}
        >
          {t('session.backgroundTasks.row.logs', 'Logs')}
          <ChevronDownIcon
            data-icon="inline-end"
            className={cn('transition-transform motion-reduce:transition-none', expanded && 'rotate-180')}
          />
        </Button>
        {active && (
          <Button
            variant="destructive"
            size="icon-sm"
            disabled={blocked || Boolean(pending) || task.state === 'stopping'}
            onClick={onStop}
            aria-label={`Stop ${task.label}`}
            title={t('session.backgroundTasks.row.stopAriaLabel', 'Stop {{label}}', {
              label: task.label,
            })}
          >
            {stopping ? <LoaderCircleIcon className="motion-safe:animate-spin" /> : <SquareIcon />}
          </Button>
        )}
      </div>
    </div>
  );
}
