/**
 * @author Codex
 * @description Confirms and executes removal of credentials stored for a model Provider.
 */

import { useState } from 'react';
import { RotateCcwIcon, TriangleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@octopus/ui/components/alert';
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
import { toast } from '@octopus/ui/components/toast';
import { useResetProviderAuth } from '@/queries/provider-auth-queries';
import { useI18n } from '@/i18n/use-i18n';
import type { ModelProviderDetailDto } from '@octopus/shared/protocol';

export interface ProviderAuthResetProps {
  provider: ModelProviderDetailDto;
  disabled?: boolean;
}

/**
 * Renders reset only for credentials that this application can actually delete.
 */
export function ProviderAuthReset({ provider, disabled = false }: ProviderAuthResetProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const resetAuth = useResetProviderAuth(provider.providerKey);
  const resettable = provider.auth.configured && provider.auth.source === 'stored';

  if (!resettable) {
    return null;
  }

  /**
   * Removes the stored credential and reports whether the refreshed snapshot is trustworthy.
   */
  async function confirmReset(): Promise<void> {
    try {
      const result = await resetAuth.mutateAsync();
      setOpen(false);
      toast.add(
        result.providerSnapshotSynchronized
          ? {
              title: t('settings.providers.auth.resetTitle', 'Authentication reset'),
              description: t('settings.providers.auth.resetDescription', 'Local credentials for {{name}} were cleared.', {
                name: provider.name,
              }),
              type: 'success',
            }
          : {
              title: t('settings.providers.auth.clearedTitle', 'Credentials cleared'),
              description: t(
                'settings.providers.auth.clearedDescription',
                'Provider status is not synced yet; refresh to confirm.'
              ),
              type: 'warning',
            }
      );
    } catch {
      // The mutation error remains local to this confirmation surface.
    }
  }

  const methodName = provider.auth.activeMethod === 'oauth' ? 'OAuth' : 'API Key';
  const errorMessage =
    resetAuth.error instanceof Error
      ? resetAuth.error.message
      : t('settings.providers.auth.resetFailed', 'Failed to reset authentication; try again later.');

  return (
    <>
      <Button
        type="button"
        size="xs"
        variant="destructive"
        disabled={disabled || resetAuth.isPending}
        onClick={() => {
          resetAuth.reset();
          setOpen(true);
        }}
      >
        <RotateCcwIcon data-icon="inline-start" />
        {t('settings.providers.auth.reset', 'Reset authentication')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!resetAuth.isPending) {
            setOpen(nextOpen);
          }
          if (!nextOpen) {
            resetAuth.reset();
          }
        }}
      >
        <DialogContent showCloseButton={!resetAuth.isPending}>
          <DialogHeader>
            <DialogTitle>
              {t('settings.providers.auth.resetConfirmTitle', 'Reset authentication for {{name}}?', {
                name: provider.name,
              })}
            </DialogTitle>
            <DialogDescription>
              {t(
                'settings.providers.auth.resetConfirmDescription',
                'This clears the locally stored {{method}} credentials; you will need to authenticate again.',
                { method: methodName }
              )}
            </DialogDescription>
          </DialogHeader>
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>
              {t('settings.providers.auth.resetImmediateTitle', 'This deletes the credential immediately')}
            </AlertTitle>
            <AlertDescription>
              {t(
                'settings.providers.auth.resetImmediateDescription',
                'If the runtime environment provides its own credential, the provider may still show as authenticated after a refresh.'
              )}
            </AlertDescription>
          </Alert>
          {resetAuth.isError ? <p className="text-sm font-medium text-destructive">{errorMessage}</p> : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={resetAuth.isPending}
              onClick={() => setOpen(false)}
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={resetAuth.isPending}
              onClick={() => void confirmReset()}
            >
              {resetAuth.isPending ? <Spinner data-icon="inline-start" /> : null}
              {t('settings.providers.auth.confirmReset', 'Confirm reset')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
