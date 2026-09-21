/**
 * @author Codex
 * @description Restores every permission and audit setting in the selected scope using revision-checked updates.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RotateCcwIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@octopus/ui/components/alert';
import { Button } from '@octopus/ui/components/button';
import { Spinner } from '@octopus/ui/components/spinner';
import { updatePermissionSettings } from '@/api/permissions';
import { useI18n } from '@/i18n/use-i18n';
import type { PermissionSettingsSnapshot } from '@octopus/shared/protocol';

/**
 * Clear the selected scope's complete overlay while preserving other scopes and rejecting stale revisions.
 */
export function PermissionResetButton({
  snapshot,
  workspaceId,
  disabled,
}: {
  snapshot: PermissionSettingsSnapshot;
  workspaceId?: string;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const client = useQueryClient();
  const reset = useMutation({
    mutationFn: () => updatePermissionSettings({ revision: snapshot.revision, config: {} }, workspaceId),
    onSuccess: async (next) => {
      client.setQueryData(['permission-settings', workspaceId ?? 'global'], next);
      await client.invalidateQueries({ queryKey: ['permission-settings'] });
    },
  });
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || reset.isPending}
        title={
          workspaceId
            ? t(
                'settings.permissions.reset.workspaceTitle',
                'Restore all defaults for the current workspace, using global configuration'
              )
            : t('settings.permissions.reset.globalTitle', 'Restore all global settings to system presets')
        }
        onClick={() => reset.mutate()}
      >
        {reset.isPending ? <Spinner /> : <RotateCcwIcon data-icon="inline-start" />}
        {t('settings.permissions.restoreDefaults', 'Restore defaults')}
      </Button>
      {reset.isError ? (
        <Alert variant="destructive" className="basis-full">
          <AlertDescription>{reset.error.message}</AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}
