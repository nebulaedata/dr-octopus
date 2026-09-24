/**
 * @author Codex
 * @description Correlates task controls with acknowledgements and authoritative session observations.
 */
import { useMemoizedFn } from 'ahooks';
import { isBackgroundTaskActive } from '@octopus/shared/protocol';
import { useRealtimeCommand } from '@/hooks/use-realtime';
import { useI18n } from '@/i18n/use-i18n';
import { sessionStores } from '@/stores/session';
import { realtimeClient } from '@/lib/runtime/realtime-client';
import { awaitRealtimeCommand } from '@/lib/runtime/await-realtime-command';

export type BackgroundTaskAction = 'logs' | 'stop' | 'all';

/**
 * Resolves only after the same runtime publishes action evidence, not merely an ACK.
 */
export function useBackgroundTaskControl(sessionId: string) {
  const send = useRealtimeCommand();
  const { t } = useI18n();
  return useMemoizedFn(async (action: BackgroundTaskAction, taskId?: string): Promise<void> => {
    const store = sessionStores.ensure(sessionId);
    const before = store.getState();
    const requestId = crypto.randomUUID();
    const target = { requestId, sessionId, runtimeId: before.runtimeId, epoch: before.epoch };
    await awaitRealtimeCommand(realtimeClient, requestId, () => {
      if (action === 'all') {
        send({ ...target, type: 'agent.abort' });
      } else {
        if (!taskId) {
          throw new Error(
            t('session.backgroundTasks.control.taskMissing', 'The task was not found; reopen the task list.')
          );
        }
        send({
          ...target,
          type: 'agent.prompt',
          payload: { message: `/octopus-background ${action} ${taskId}` },
        });
      }
    });
    const after = store.getState();
    const snapshot = after.backgroundTasks;
    if (
      after.runtimeId !== before.runtimeId ||
      after.epoch !== before.epoch ||
      !snapshot ||
      (before.backgroundTasks && snapshot.generation !== before.backgroundTasks.generation)
    ) {
      throw new Error(
        t(
          'session.backgroundTasks.control.sessionChanged',
          'The session state changed; reopen the task list and try again.'
        )
      );
    }
    if (
      action === 'logs' &&
      (snapshot.error ||
        snapshot.logs?.taskId !== taskId ||
        snapshot.revision <= (before.backgroundTasks?.revision ?? -1))
    ) {
      throw new Error(
        t('session.backgroundTasks.control.logsStale', 'The latest logs have not arrived yet; try again.')
      );
    }
    const task = snapshot.tasks.find((item) => item.taskId === taskId);
    if (
      (action === 'all' && (snapshot.activeCount !== 0 || !snapshot.accepting)) ||
      (action === 'stop' && (!task || isBackgroundTaskActive(task)))
    ) {
      throw new Error(
        t(
          'session.backgroundTasks.control.stopUnconfirmed',
          'The stop is not confirmed yet; try again later.'
        )
      );
    }
  });
}
