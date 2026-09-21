/**
 * @author Codex
 * @description Maps lifecycle evidence to concise user-facing status and timing labels.
 */
import type { Translate } from '@/i18n/use-i18n';
import type { BackgroundTaskDto } from '@octopus/shared/protocol';

/**
 * Distinguishes unsuccessful natural exits from successfully completed commands.
 */
export function describeBackgroundTask(t: Translate, task: BackgroundTaskDto) {
  const failed =
    task.state === 'failed' ||
    task.state === 'unknown' ||
    (task.state === 'exited' && typeof task.exitCode === 'number' && task.exitCode !== 0);
  const labels = {
    starting: t('session.backgroundTasks.status.starting', 'Starting'),
    running: t('session.backgroundTasks.status.running', 'Running'),
    stopping: t('session.backgroundTasks.status.stopping', 'Stopping'),
    stopped: t('session.backgroundTasks.status.stopped', 'Stopped'),
    exited: t('session.backgroundTasks.status.exited', 'Completed'),
    failed: t('session.backgroundTasks.status.failed', 'Launch failed'),
    unknown: t('session.backgroundTasks.status.unknown', 'Unknown state'),
  };
  return {
    label:
      failed && task.state === 'exited'
        ? t('session.backgroundTasks.status.exitedFailed', 'Execution failed')
        : labels[task.state],
    failed,
    busy: task.state === 'starting' || task.state === 'stopping',
    time: new Date(task.createdAt).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }),
  };
}
