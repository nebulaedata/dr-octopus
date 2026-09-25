/**
 * @author Codex
 * @description Confirms deletion of a Host-managed model provider and reports dependency errors.
 */

import { useState } from 'react';
import { Trash2Icon } from 'lucide-react';
import { Alert, AlertDescription } from '@octopus/ui/components/alert';
import { Button } from '@octopus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@octopus/ui/components/dialog';
import { Spinner } from '@octopus/ui/components/spinner';
import { useCustomProviderMutations } from '@/queries/custom-provider-queries';
import { useI18n } from '@/i18n/use-i18n';
import type { ModelProviderDetailDto } from '@octopus/shared/protocol';

/**
 * Exposes deletion only for providers created through the Settings UI.
 */
export function DeleteCustomProviderDialog({
  provider,
  onDeleted,
}: {
  provider: ModelProviderDetailDto;
  onDeleted(): void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const { remove } = useCustomProviderMutations(provider.providerKey);
  if (!provider.local) {
    return null;
  }
  /**
   * Removes the selected provider after the Server checks the current default pair.
   */
  async function confirmDelete(): Promise<void> {
    try {
      await remove.mutateAsync();
      setOpen(false);
      onDeleted();
    } catch {
      // Keep the dialog open with the returned error.
    }
  }
  return (
    <>
      <Button
        variant="destructive"
        size="sm"
        onClick={() => {
          remove.reset();
          setOpen(true);
        }}
      >
        <Trash2Icon data-icon="inline-start" />
        {t('settings.providers.delete', 'Delete provider')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!remove.isPending) {
            setOpen(nextOpen);
          }
        }}
      >
        <DialogContent showCloseButton={!remove.isPending}>
          <DialogHeader>
            <DialogTitle>
              {t('settings.providers.deleteTitle', 'Delete {{name}}?', { name: provider.name })}
            </DialogTitle>
            <DialogDescription>
              {t(
                'settings.providers.deleteDescription',
                'This removes the provider and its model configuration. Select another default model first if this provider is currently the default.'
              )}
            </DialogDescription>
          </DialogHeader>
          {provider.defaultModelId && (
            <Alert>
              <AlertDescription>
                {t(
                  'settings.providers.deleteDefaultBlocked',
                  'This provider is the current default. Choose another default model before deleting it.'
                )}
              </AlertDescription>
            </Alert>
          )}
          {remove.isError && (
            <Alert variant="destructive">
              <AlertDescription>{remove.error.message}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={remove.isPending} onClick={() => setOpen(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending || provider.defaultModelId !== undefined}
              onClick={() => void confirmDelete()}
            >
              {remove.isPending && <Spinner data-icon="inline-start" />}
              {t('settings.providers.confirmDelete', 'Delete provider')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
