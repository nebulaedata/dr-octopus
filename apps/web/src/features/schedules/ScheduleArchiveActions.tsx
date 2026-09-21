/**
 * @author Codex
 * @description Confirms archived task recovery and irreversible deletion with visible pending/error feedback.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LoaderCircleIcon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@octopus/ui/components/dialog';
import { ScheduleDialogContent } from './ScheduleDialog';
import { mutateScheduledTask } from '@/api/scheduled-tasks';
import { useI18n } from '@/i18n/use-i18n';
import type { ScheduledTask } from '@octopus/shared/protocol/scheduled-tasks';

/**
 * Require deliberate confirmation and retain the dialog when the server rejects a stale or busy task.
 */
export function ScheduleArchiveActions({ task }: { task: ScheduledTask }) {
  const [action, setAction] = useState<'restore' | 'purge'>();
  const { t } = useI18n();
  const [key, setKey] = useState('');
  const queries = useQueryClient();
  const mutation = useMutation({
    mutationFn: (operation: 'restore' | 'purge') =>
      mutateScheduledTask(task.workspaceId, {
        operation,
        taskId: task.id,
        revision: task.revision,
        key,
        input: {},
      }),
    onSuccess: async () => {
      setAction(undefined);
      await queries.invalidateQueries({ queryKey: ['scheduled-tasks'] });
    },
  });
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={!!task.hasActiveRun || mutation.isPending}
        onClick={() => {
          mutation.reset();
          setKey(crypto.randomUUID());
          setAction('restore');
        }}
      >
        {t('schedules.archive.restore', 'Restore task')}
      </Button>
      <Button
        size="sm"
        variant="destructive"
        disabled={!!task.hasActiveRun || mutation.isPending}
        onClick={() => {
          mutation.reset();
          setKey(crypto.randomUUID());
          setAction('purge');
        }}
      >
        {t('schedules.archive.purge', 'Delete permanently')}
      </Button>
      {task.hasActiveRun && (
        <span className="text-xs text-muted-foreground">
          {t(
            'schedules.archive.activeRunNote',
            'Available to restore or delete once the active run finishes'
          )}
        </span>
      )}
      <Dialog
        open={action !== undefined}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) {
            setAction(undefined);
          }
        }}
      >
        <ScheduleDialogContent>
          <DialogHeader>
            <DialogTitle>
              {action === 'purge'
                ? t('schedules.archive.purgeTitle', 'Permanently delete the task?')
                : t('schedules.archive.restoreTitle', 'Restore the archived task?')}
            </DialogTitle>
            <DialogDescription>
              {task.name}{'. '}
              {action === 'purge'
                ? t(
                    'schedules.archive.purgeDescription',
                    'This permanently deletes the task, its run history, and its isolated run session files; it cannot be undone. Messages already echoed into the source session, files the task generated in the workspace, and the necessary authorization audit are kept.'
                  )
                : t(
                    'schedules.archive.restoreDescription',
                    'Run history is kept, and the task returns paused pending re-authorization; resume it manually after authorizing.'
                  )}
            </DialogDescription>
          </DialogHeader>
          {mutation.error && (
            <p role="alert" className="text-sm text-destructive">
              {mutation.error.message}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={mutation.isPending} onClick={() => setAction(undefined)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              variant={action === 'purge' ? 'destructive' : 'default'}
              disabled={mutation.isPending}
              onClick={() => action && mutation.mutate(action)}
            >
              {mutation.isPending && <LoaderCircleIcon className="animate-spin" />}
              {mutation.isPending
                ? t('schedules.archive.processing', 'Processing…')
                : action === 'purge'
                  ? t('schedules.archive.confirmPurge', 'Confirm permanent deletion')
                  : t('schedules.archive.confirmRestore', 'Confirm restore')}
            </Button>
          </DialogFooter>
        </ScheduleDialogContent>
      </Dialog>
    </>
  );
}
