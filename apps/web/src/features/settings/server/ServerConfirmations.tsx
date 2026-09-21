/**
 * @author Codex
 * @description Keeps exposure consent and unsaved-navigation confirmation explicit.
 */
import { useBlocker } from '@tanstack/react-router';
import { Button } from '@octopus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@octopus/ui/components/dialog';
import { useI18n } from '@/i18n/use-i18n';

/**
 * Confirms only the captured patch; cancellation retains the editor draft.
 */
export function ServerExposureDialog({
  open,
  pending,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  pending: boolean;
  /**
   * Dismisses consent without changing the draft.
   */
  onCancel(): void;
  /**
   * Resubmits the exact revision and patch with exposure consent.
   */
  onConfirm(): void;
}) {
  const { t } = useI18n();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) {
          onCancel();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settings.server.exposure.title', 'Allow access from other devices?')}</DialogTitle>
          <DialogDescription>
            {t(
              'settings.server.exposure.description',
              'Other devices that can reach this service can access the workspace, files, Agent tools, and service settings. Only use this on trusted networks. A manual restart is required after saving.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={onConfirm}>
            {t('settings.server.exposure.confirm', 'Confirm and save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
/**
 * Covers modal history navigation and page unload without discarding dirty fields silently.
 */
export function UnsavedGuard({ dirty }: { dirty: boolean }) {
  const { t } = useI18n();
  useBlocker({
    shouldBlockFn: () =>
      dirty &&
      !window.confirm(t('settings.server.unsavedConfirm', 'You have unsaved server settings. Leave and discard your changes?')),
    enableBeforeUnload: dirty,
  });
  return null;
}
