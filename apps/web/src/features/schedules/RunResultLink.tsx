/**
 * @author Codex
 * @description Resolves a retained execution into its real Session with visible loading and failure states.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ArrowDownRightIcon, LoaderCircleIcon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import { resolveRunSession } from '@/api/notifications';
import { useI18n } from '@/i18n/use-i18n';
/**
 * Navigate only after registration succeeds; opening a result never dispatches work.
 */
export function RunResultLink({
  workspaceId,
  taskId,
  runId,
}: {
  workspaceId: string;
  taskId: string;
  runId: string;
}) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const client = useQueryClient();
  const result = useMutation({
    mutationFn: () => resolveRunSession(workspaceId, taskId, runId),
    onSuccess: async (params) => {
      await client.invalidateQueries({ queryKey: ['sessions', workspaceId] });
      await navigate({ to: '/workspaces/$workspaceId/sessions/$sessionId', params });
    },
  });
  return (
    <div>
      <Button size="sm" variant="outline" disabled={result.isPending} onClick={() => result.mutate()}>
        {result.isPending && <LoaderCircleIcon className="animate-spin" />}
        {result.isPending
          ? t('schedules.runResult.opening', 'Opening…')
          : t('schedules.runResult.openSession', 'Open session')}
        <ArrowDownRightIcon data-icon="inline-end" />
      </Button>
      {result.error && (
        <p role="alert" className="mt-1 text-sm text-destructive">
          {result.error.message}
        </p>
      )}
    </div>
  );
}
