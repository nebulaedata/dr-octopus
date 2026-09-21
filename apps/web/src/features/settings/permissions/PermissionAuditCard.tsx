/**
 * @author Codex
 * @description Separates audit recording controls from permission decisions while preserving scoped inheritance.
 */
import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, AlertDescription } from '@octopus/ui/components/alert';
import { Card, CardContent } from '@octopus/ui/components/card';
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '@octopus/ui/components/field';
import { Slider } from '@octopus/ui/components/slider';
import { Switch } from '@octopus/ui/components/switch';
import { updatePermissionSettings } from '@/api/permissions';
import { useI18n } from '@/i18n/use-i18n';
import type { PermissionConfig, PermissionSettingsSnapshot } from '@octopus/shared/protocol';

/**
 * Save audit controls independently while preserving other scoped permission settings.
 */
export function PermissionAuditCard({
  snapshot,
  workspaceId,
}: {
  snapshot: PermissionSettingsSnapshot;
  workspaceId?: string;
}) {
  const { t } = useI18n();
  const toggleId = useId();
  const lengthId = useId();
  const [draftLength, setDraftLength] = useState<number>();
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: (patch: Pick<PermissionConfig, 'permissionReviewLog' | 'reviewLogFieldMaxWidth'>) => {
      const config = structuredClone(snapshot.overrides ?? {});
      Object.assign(config, patch);
      for (const key of ['permissionReviewLog', 'reviewLogFieldMaxWidth'] as const) {
        if (config[key] === undefined) {
          delete config[key];
        }
      }
      return updatePermissionSettings({ revision: snapshot.revision, config }, workspaceId);
    },
    onSettled: () => setDraftLength(undefined),
    onSuccess: async (next) => {
      client.setQueryData(['permission-settings', workspaceId ?? 'global'], next);
      await client.invalidateQueries({ queryKey: ['permission-settings'] });
    },
  });
  const config = snapshot.effective;
  if (!config) {
    return null;
  }
  const length = draftLength ?? config.reviewLogFieldMaxWidth;
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <FieldGroup>
          <Field orientation="horizontal" data-disabled={save.isPending}>
            <FieldContent>
              <FieldLabel htmlFor={toggleId}>
                {t('settings.permissions.audit.toggleLabel', 'Record permission audit log')}
              </FieldLabel>
              <FieldDescription>
                {t(
                  'settings.permissions.audit.toggleDescription',
                  'When enabled, records tool permission requests and approval results for queries and troubleshooting'
                )}
              </FieldDescription>
            </FieldContent>
            <Switch
              id={toggleId}
              checked={config.permissionReviewLog}
              onCheckedChange={(checked) => save.mutate({ permissionReviewLog: checked })}
              disabled={save.isPending}
            />
          </Field>
          <Field orientation="horizontal" data-disabled={save.isPending}>
            <FieldContent>
              <FieldLabel htmlFor={lengthId}>
                {t('settings.permissions.audit.lengthLabel', 'Log text retention length')}
              </FieldLabel>
              <FieldDescription>
                {t(
                  'settings.permissions.audit.lengthDescription',
                  'Maximum characters kept per text field; the excess is truncated'
                )}
              </FieldDescription>
            </FieldContent>
            <div className="grid w-full max-w-36 gap-2">
              <div className="flex items-center justify-between">
                <output className="text-[11px] text-muted-foreground font-geist tabular-nums">1</output>
                <output className="text-[11px] text-muted-foreground font-geist tabular-nums">100000</output>
              </div>
              <Slider
                id={lengthId}
                aria-labelledby={lengthId}
                min={1}
                max={100000}
                step={1}
                value={[length]}
                disabled={save.isPending}
                onValueChange={(value) => setDraftLength(Array.isArray(value) ? value[0] : value)}
                onValueCommitted={(value) => {
                  const next = Array.isArray(value) ? value[0] : value;
                  if (next !== config.reviewLogFieldMaxWidth) {
                    save.mutate({ reviewLogFieldMaxWidth: next });
                  } else {
                    setDraftLength(undefined);
                  }
                }}
              />
              <output className="text-xs text-primary font-geist tabular-nums">
                {length.toLocaleString()}
              </output>
            </div>
          </Field>
        </FieldGroup>
        {save.isError && (
          <Alert variant="destructive">
            <AlertDescription>{save.error.message}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
