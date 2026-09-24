/**
 * @author Codex
 * @description Presents the shared interruption confirmation and request failure for Session restart actions.
 */
import { Button } from '@octopus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@octopus/ui/components/dialog';
import { useI18n } from '@/i18n/use-i18n';
import type { useRestartSession } from '@/features/session/hooks/use-restart-session';

/**
 * Keeps interruption authorization explicit without changing the selected Session.
 */
export function RestartSessionDialog({ action }: { action: ReturnType<typeof useRestartSession> }) {
  const { t } = useI18n();
  return (
    <Dialog
      open={!!action.confirmation || !!action.error}
      onOpenChange={(open) => {
        if (!open && !action.isPending) {
          action.dismiss();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {action.error
              ? t('session.restartDialog.errorTitle', 'Restart failed')
              : t('session.restartDialog.confirmTitle', 'Restart session: {{title}}', {
                  title: action.confirmation?.session.title ?? '',
                })}
          </DialogTitle>
          <DialogDescription>
            {action.error ??
              t(
                'session.restartDialog.description',
                'The current task will be interrupted; saved chat history and file changes are kept. Restart this session?'
              )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={action.isPending} onClick={action.dismiss}>
            {action.error ? t('common.close', 'Close') : t('common.cancel', 'Cancel')}
          </Button>
          {!action.error && (
            <Button disabled={action.isPending} onClick={action.confirm}>
              {action.isPending
                ? t('session.restartDialog.pending', 'Restarting…')
                : t('session.restartDialog.confirm', 'Interrupt and restart')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
