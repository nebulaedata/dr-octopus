/**
 * @author Codex
 * @description Sends every knowledge job state to Toast without rendering an inline task status panel.
 */
import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@octopus/ui/components/toast';
import { changeKnowledgeJob } from '@/api/knowledge';
import { getKnowledgeJobNotification } from './knowledge-job-feedback';
import { useI18n } from '@/i18n/use-i18n';
import type { KnowledgeJob } from '@octopus/shared/protocol/knowledge';
import type { KnowledgeJobResult } from './knowledge-job-feedback';

/**
 * Deduplicates event-driven outcomes by job attempt and keeps each retry bound to the job that failed.
 */
export function KnowledgeJobFeedback({
  workspaceId,
  result,
}: {
  workspaceId?: string;
  result: KnowledgeJobResult;
}) {
  const cache = useQueryClient();
  const { t } = useI18n();
  const notified = useRef(new Set<string>());
  const notifications = useRef(new Set<string>());
  const action = useMutation({
    mutationFn: ({ target, kind }: { target: KnowledgeJob; kind: 'cancel' | 'retry' }) =>
      changeKnowledgeJob(workspaceId, target, kind),
    onError: (error) => {
      toast.add({ title: t('knowledge.jobFeedback.actionFailed', 'Task action failed'), description: error.message, type: 'error' });
    },
    onSuccess: async (_, { target }) => {
      await cache.invalidateQueries({ queryKey: ['knowledge', workspaceId ?? 'global', 'job', target.id] });
      await cache.invalidateQueries({
        queryKey: ['knowledge', workspaceId ?? 'global', target.collectionId],
      });
    },
  });
  const mutate = action.mutate;
  useEffect(() => {
    const notification = getKnowledgeJobNotification(t, result);
    if (notified.current.has(notification.key)) {
      return;
    }
    notified.current.add(notification.key);
    for (const id of notifications.current) {
      toast.close(id);
    }
    notifications.current.clear();
    const kind = notification.action;
    const notificationId = toast.add({
      title: notification.title,
      description: notification.description,
      type: notification.type,
      timeout: notification.timeout,
      actionProps: kind
        ? {
            children:
              kind === 'retry'
                ? t('common.retry', 'Retry')
                : t('knowledge.jobFeedback.cancelTask', 'Cancel task'),
            onClick: () => {
              toast.close(notificationId);
              mutate({ target: result.job, kind });
            },
          }
        : undefined,
    });
    notifications.current.add(notificationId);
  }, [result, mutate, t]);
  useEffect(() => {
    const ids = notifications.current;
    const seen = notified.current;
    return () => {
      for (const id of ids) {
        toast.close(id);
      }
      ids.clear();
      seen.clear();
    };
  }, []);
  return null;
}
