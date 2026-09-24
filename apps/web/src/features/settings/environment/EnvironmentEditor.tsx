/**
 * @author Codex
 * @description Edits a single persisted environment override without reading back existing credentials.
 */
import { useForm } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { useSafeState } from 'ahooks';
import { Alert, AlertDescription } from '@octopus/ui/components/alert';
import { Button } from '@octopus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@octopus/ui/components/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@octopus/ui/components/field';
import { Input } from '@octopus/ui/components/input';
import { Spinner } from '@octopus/ui/components/spinner';
import { toast } from '@octopus/ui/components/toast';
import { updateEnvironmentSettings } from '@/api/environment';
import { useI18n } from '@/i18n/use-i18n';
import { ApiRequestError } from '@/utils/request';
import { environmentErrorMessage } from '@/features/settings/utils/environment-labels';
import type { EnvironmentEntryDto, EnvironmentSettingsDto } from '@octopus/shared/protocol';

interface EnvironmentEditorProps {
  snapshot: EnvironmentSettingsDto;
  entry?: EnvironmentEntryDto;
  /**
   * Discards the local draft only after saving or explicit dismissal.
   */
  onClose(): void;
}

/**
 * Uses a captured revision so background refetches cannot silently authorize stale edits.
 */
export function EnvironmentEditor({ snapshot, entry, onClose }: EnvironmentEditorProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [pending, setPending] = useSafeState(false);
  const [error, setError] = useSafeState<string>();
  const [exposure, setExposure] = useSafeState<Record<string, string | null>>();
  const submitting = useRef(false);
  const sensitive = entry?.sensitive ?? snapshot.scope === 'agent';
  /**
   * Keeps credentials out of mutation variables, cached errors, and Query devtools.
   */
  async function save(changes: Record<string, string | null>, confirmed = false): Promise<void> {
    if (submitting.current) {
      return;
    }
    submitting.current = true;
    setPending(true);
    setError(undefined);
    try {
      const next = await updateEnvironmentSettings(
        snapshot.scope,
        { revision: snapshot.revision, changes },
        confirmed
      );
      queryClient.setQueryData(['environment-settings', snapshot.scope], next);
      await queryClient.invalidateQueries({ queryKey: ['server-settings'] });
      toast.add({
        title: t('settings.environment.saved', 'Environment variable saved'),
        description:
          snapshot.scope === 'server'
            ? t('settings.environment.savedServerDescription', 'Takes effect after restarting the Server.')
            : t(
                'settings.environment.savedAgentDescription',
                'Newly started Agent processes will read the new configuration; running processes need a restart.'
              ),
        type: 'success',
      });
      onClose();
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.code === 'SERVER_EXPOSURE_CONFIRMATION_REQUIRED') {
        setExposure(changes);
      } else {
        setError(environmentErrorMessage(t, cause));
      }
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  const form = useForm({
    defaultValues: { key: entry?.key ?? '', value: entry?.storedValue ?? '' },
    onSubmit: async ({ value }) => {
      await save({ [value.key]: value.value });
    },
  });
  const overridden =
    entry?.source === 'process' || entry?.source === 'dotenv' || entry?.source === 'override';

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) {
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg" showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>
            {entry
              ? t('settings.environment.editTitle', 'Edit environment variable')
              : t('settings.environment.addTitle', 'Add environment variable')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'settings.environment.dialogDescription',
              'Saved to the {{scope}} configuration. Deleting the entry falls back to other sources.',
              { scope: snapshot.scope === 'server' ? 'Server' : 'Agent' }
            )}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <FieldGroup>
            <form.Field
              name="key"
              validators={{
                onChange: ({ value }) => {
                  if (!/^[A-Z_][A-Z0-9_]{0,127}$/.test(value)) {
                    return t(
                      'settings.environment.keyFormatError',
                      'Use uppercase letters, digits, or underscores; cannot start with a digit.'
                    );
                  }
                  if (
                    !entry &&
                    snapshot.entries.some((item) => item.key.toUpperCase() === value.toUpperCase())
                  ) {
                    return t(
                      'settings.environment.keyExistsError',
                      'This variable already exists; edit the existing entry.'
                    );
                  }
                  return undefined;
                },
              }}
            >
              {(field) => (
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  <FieldLabel htmlFor="environment-key">
                    {t('settings.environment.keyLabel', 'Variable name')}
                  </FieldLabel>
                  <Input
                    id="environment-key"
                    value={field.state.value}
                    disabled={Boolean(entry) || pending}
                    spellCheck={false}
                    autoComplete="off"
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    aria-invalid={field.state.meta.errors.length > 0}
                    placeholder={t('settings.environment.keyPlaceholder', 'e.g. OPENAI_API_KEY')}
                  />
                  <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
                </Field>
              )}
            </form.Field>
            <form.Field
              name="value"
              validators={{
                onChange: ({ value }) =>
                  value.includes('\0') || value.length > 8192
                    ? t(
                        'settings.environment.valueInvalidError',
                        'Value cannot contain NUL and must be at most 8192 characters.'
                      )
                    : undefined,
              }}
            >
              {(field) => (
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  <FieldLabel htmlFor="environment-value">
                    {sensitive && entry?.hasStoredValue
                      ? t('settings.environment.replaceValueLabel', 'Replace with new value')
                      : t('settings.environment.valueLabel', 'Value')}
                  </FieldLabel>
                  <Input
                    id="environment-value"
                    type={sensitive ? 'password' : 'text'}
                    autoComplete="off"
                    spellCheck={false}
                    value={field.state.value}
                    disabled={pending}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    aria-invalid={field.state.meta.errors.length > 0}
                    placeholder={
                      sensitive && entry?.hasStoredValue
                        ? t(
                            'settings.environment.replaceValuePlaceholder',
                            'The existing value is hidden; enter a new value'
                          )
                        : t('settings.environment.valuePlaceholder', 'Enter a value')
                    }
                  />
                  <FieldDescription>
                    {sensitive
                      ? t(
                          'settings.environment.sensitiveDescription',
                          'Custom variables are treated as sensitive and are not echoed after saving.'
                        )
                      : t(
                          'settings.environment.valueDescription',
                          'Leave empty to save an empty string; delete the entry to restore other sources.'
                        )}
                  </FieldDescription>
                  <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
                </Field>
              )}
            </form.Field>
          </FieldGroup>
          {overridden ? (
            <Alert>
              <AlertDescription>
                {t(
                  'settings.environment.overriddenAlert',
                  'This variable is overridden by launch arguments or the process environment. The new value is saved but only used after the upper-level override is removed.'
                )}
              </AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {exposure ? (
            <Alert variant="destructive">
              <AlertDescription>
                {t(
                  'settings.environment.exposureAlert',
                  'Other devices that can reach this service can access the workspace, files, Agent tools, and service settings. Only use this on trusted networks.'
                )}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={() => setExposure(undefined)}
                  >
                    {t('common.cancel', 'Cancel')}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={pending}
                    onClick={() => void save(exposure, true)}
                  >
                    {t('settings.environment.confirmExposureSave', 'Confirm and save')}
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            {entry?.hasStoredValue ? (
              <Button
                type="button"
                variant="destructive"
                disabled={pending}
                onClick={() => void save({ [entry.key]: null })}
              >
                {t('settings.environment.deleteEntry', 'Delete entry')}
              </Button>
            ) : null}
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <form.Subscribe
              selector={(state) => [state.canSubmit, state.values.value, state.values.key] as const}
            >
              {([canSubmit, value, key]) => (
                <Button type="submit" disabled={!canSubmit || !key || pending || (sensitive && !value)}>
                  {pending ? <Spinner data-icon="inline-start" /> : null}
                  {t('common.save', 'Save')}
                </Button>
              )}
            </form.Subscribe>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
