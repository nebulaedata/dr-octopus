/**
 * @author Codex
 * @description Resolves task status in priority order and presents distinct, theme-aware status badges.
 */
import {
  ArchiveIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CirclePlayIcon,
  LoaderCircleIcon,
  PauseIcon,
} from 'lucide-react';
import { Badge } from '@octopus/ui/components/badge';
import { cn } from '@octopus/ui/lib/utils';
import { useI18n } from '@/i18n/use-i18n';
import type { ScheduledTask } from '@octopus/shared/protocol/scheduled-tasks';
import type { Translate } from '@/i18n/use-i18n';

const statusConfig = {
  archived: {
    icon: ArchiveIcon,
    className: 'border-border bg-muted text-muted-foreground',
  },
  blocked: {
    icon: CircleAlertIcon,
    className: 'border-destructive/20 bg-destructive/10 text-destructive',
  },
  restricted: {
    icon: CircleAlertIcon,
    className: 'border-destructive/20 bg-destructive/10 text-destructive',
  },
  paused: {
    icon: PauseIcon,
    className: 'border-warning-foreground/20 bg-warning text-warning-foreground',
  },
  running: {
    icon: LoaderCircleIcon,
    className:
      'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/25 dark:bg-blue-400/10 dark:text-blue-300',
  },
  enabled: {
    icon: CirclePlayIcon,
    className:
      'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-300',
  },
  completed: {
    icon: CircleCheckIcon,
    className:
      'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-400/25 dark:bg-violet-400/10 dark:text-violet-300',
  },
};

type TaskStatus = keyof typeof statusConfig;

/**
 * Localizes the task status badge text resolved from the catalog precedence rules.
 */
function scheduleTaskStatusLabel(t: Translate, status: TaskStatus): string {
  return {
    archived: t('schedules.taskStatus.archived', 'Archived'),
    blocked: t('schedules.taskStatus.blocked', 'Pending authorization / needs attention'),
    restricted: t('schedules.taskStatus.restricted', 'Execution restricted'),
    paused: t('schedules.taskStatus.paused', 'Schedule paused'),
    running: t('schedules.taskStatus.running', 'Running'),
    enabled: t('schedules.taskStatus.enabled', 'Enabled'),
    completed: t('schedules.taskStatus.completed', 'Completed'),
  }[status];
}

/**
 * Preserves catalog precedence when multiple task flags are set.
 * Archive and authorization restrictions take priority over execution state.
 */
function getTaskStatus(task: ScheduledTask): TaskStatus {
  if (task.deletedAt) {
    return 'archived';
  }
  if (task.authorizationBlock === 'SCHEDULE_PERMISSION_DENIED') {
    return 'restricted';
  }
  if (task.authorizationBlock || !task.authorizationRef) {
    return 'blocked';
  }
  if (task.pausedAt) {
    return 'paused';
  }
  if (task.hasActiveRun) {
    return 'running';
  }
  if (task.enabled) {
    return 'enabled';
  }
  return 'completed';
}

/**
 * Pairs status text with color and an icon so recognition does not depend on color alone.
 */
export function ScheduleTaskStatusBadge({ task }: { task: ScheduledTask }) {
  const { t } = useI18n();
  const status = getTaskStatus(task);
  const { icon: Icon, className } = statusConfig[status];

  return (
    <div className="flex shrink-0 flex-col items-end gap-1.5">
      <Badge variant="outline" className={cn('h-6 gap-1.5 px-2.5', className)}>
        <Icon
          aria-hidden="true"
          data-icon="inline-start"
          className={cn(status === 'running' && 'motion-safe:animate-spin')}
        />
        {scheduleTaskStatusLabel(t, status)}
      </Badge>
      {task.hasActiveRun && status !== 'running' && (
        <Badge variant="outline" className={cn('h-6 gap-1.5 px-2.5', statusConfig.running.className)}>
          <LoaderCircleIcon
            aria-hidden="true"
            data-icon="inline-start"
            className="motion-safe:animate-spin"
          />
          {scheduleTaskStatusLabel(t, 'running')}
        </Badge>
      )}
    </div>
  );
}
