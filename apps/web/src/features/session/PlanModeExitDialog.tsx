/**
 * @author Codex
 * @description Confirms discarding a ready pi-plan-mode plan before returning to Agent mode.
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

export interface PlanModeExitDialogProps {
  open: boolean;
  /**
   * Controls dialog visibility.
   */
  onOpenChange(open: boolean): void;
  /**
   * Confirms the destructive Plan exit command.
   */
  onConfirm(): void;
}

/**
 * Warns only when pi-plan-mode reports a completed plan awaiting action.
 */
export function PlanModeExitDialog({ open, onOpenChange, onConfirm }: PlanModeExitDialogProps) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('session.planExit.title', 'Discard the ready plan?')}</DialogTitle>
          <DialogDescription>
            {t(
              'session.planExit.description',
              "Returning to Agent mode runs the Plan extension's exit workflow and discards the proposed plan."
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('session.planExit.keep', 'Keep planning')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {t('session.planExit.discard', 'Discard and exit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
