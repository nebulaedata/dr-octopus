/**
 * @author Codex
 * @description Resolves an authorization deep link without depending on the visible task catalog.
 */
import { useQuery } from '@tanstack/react-query';
import { Button } from '@octopus/ui/components/button';
import { Dialog, DialogHeader, DialogTitle, DialogDescription } from '@octopus/ui/components/dialog';
import { getScheduledTask } from '@/api/scheduled-tasks';
import { ScheduleAuthorization } from './ScheduleAuthorization';
import { ScheduleDialogContent } from './ScheduleDialog';
import { useI18n } from '@/i18n/use-i18n';

/**
 * Fetches current task state before opening the existing explicit authorization review.
 */
export function ScheduleAuthorizationRequest({
  workspaceId,
  taskId,
  onClose,
}: {
  workspaceId: string;
  taskId: string;
  /**
   * Clears the URL target after the user dismisses the request.
   */
  onClose(): void;
}) {
  const task = useQuery({
    queryKey: ['scheduled-tasks', workspaceId, 'detail', taskId],
    queryFn: ({ signal }) => getScheduledTask(workspaceId, taskId, signal),
    retry: false,
  });
  const { t } = useI18n();
  if (task.data && !task.isError) {
    return <ScheduleAuthorization task={task.data} workspaceId={workspaceId} defaultOpen onClose={onClose} />;
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <ScheduleDialogContent>
        <DialogHeader>
          <DialogTitle>{t('schedules.authorizationRequest.title', 'Review & authorize')}</DialogTitle>
          <DialogDescription>
            {t(
              'schedules.authorizationRequest.description',
              'Reading the latest state of the target scheduled task.'
            )}
          </DialogDescription>
        </DialogHeader>
        {task.isError ? (
          <>
            <p role="alert" className="text-sm text-destructive">
              {t(
                'schedules.authorizationRequest.openFailed',
                'Unable to open the task; it may have been deleted or is currently unavailable: {{message}}',
                { message: task.error.message }
              )}
            </p>
            <Button variant="outline" onClick={() => void task.refetch()}>
              {t('common.retry', 'Retry')}
            </Button>
          </>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {t('schedules.authorizationRequest.loading', 'Loading task…')}
          </p>
        )}
      </ScheduleDialogContent>
    </Dialog>
  );
}
