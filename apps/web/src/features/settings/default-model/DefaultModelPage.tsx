/**
 * @author Codex
 * @description Provides a TanStack Form for selecting the Pi global default model.
 */

import { SettingContainer } from '../Layout/SettingContainer';
import { useEffect } from 'react';
import { useForm } from '@tanstack/react-form';
import { Alert, AlertDescription, AlertTitle } from '@octopus/ui/components/alert';
import { Badge } from '@octopus/ui/components/badge';
import { Button } from '@octopus/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@octopus/ui/components/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@octopus/ui/components/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@octopus/ui/components/select';
import { Skeleton } from '@octopus/ui/components/skeleton';
import { Spinner } from '@octopus/ui/components/spinner';
import { toast } from '@octopus/ui/components/toast';
import { useDefaultModelSettings, useUpdateDefaultModel } from '@/queries/settings-queries';
import { useI18n } from '@/i18n/use-i18n';
import type { DefaultModelCandidateDto } from '@octopus/shared/protocol';

interface DefaultModelFormValues {
  selection: string;
}

/**
 * Encodes two opaque keys into one Select value without exposing Provider IDs.
 *
 * @param providerKey Opaque Provider key.
 * @param modelKey Opaque model key.
 * @returns Select-safe JSON value.
 */
function encodeSelection(providerKey: string, modelKey: string): string {
  return JSON.stringify([providerKey, modelKey]);
}

/**
 * Decodes the selected opaque pair.
 *
 * @param selection Select value emitted by the form.
 * @returns Provider and model keys.
 */
function decodeSelection(selection: string): { providerKey: string; modelKey: string } {
  const [providerKey, modelKey] = JSON.parse(selection) as [string, string];
  return { providerKey, modelKey };
}

/**
 * Groups candidates by Provider without requiring an ES2024 runtime.
 *
 * @param candidates Flat candidate catalog.
 * @returns Insertion-ordered Provider groups.
 */
function groupCandidates(candidates: DefaultModelCandidateDto[]): Map<string, DefaultModelCandidateDto[]> {
  const groups = new Map<string, DefaultModelCandidateDto[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.providerName) ?? [];
    group.push(candidate);
    groups.set(candidate.providerName, group);
  }
  return groups;
}

/**
 * Renders the global default-model state and mutation form.
 */
export function DefaultModelPage() {
  const { t } = useI18n();
  const { current, candidates } = useDefaultModelSettings();
  const update = useUpdateDefaultModel();
  const form = useForm({
    defaultValues: { selection: '' } satisfies DefaultModelFormValues,
    onSubmit: async ({ value }) => {
      await update.mutateAsync(decodeSelection(value.selection));
      toast.add({
        title: t('settings.defaultModel.updated', 'Default model updated'),
        description: t('settings.defaultModel.updatedDescription', 'New sessions will use this model.'),
        type: 'success',
      });
    },
  });

  useEffect(() => {
    if (current.data?.providerKey !== undefined && current.data.modelKey !== undefined) {
      form.setFieldValue('selection', encodeSelection(current.data.providerKey, current.data.modelKey));
    }
  }, [current.data?.modelKey, current.data?.providerKey, form]);

  if (current.isPending || candidates.isPending) {
    return (
      <SettingContainer classNames={{ content: 'mx-0 max-w-none gap-4' }}>
        <Skeleton className="h-32 w-full max-w-3xl" />
        <Skeleton className="h-64 w-full max-w-3xl" />
      </SettingContainer>
    );
  }
  const queryError = current.error ?? candidates.error;
  if (queryError instanceof Error) {
    return (
      <SettingContainer classNames={{ content: 'max-w-none' }}>
        <Alert variant="destructive">
          <AlertTitle>{t('settings.defaultModel.loadFailed', 'Failed to load the default model')}</AlertTitle>
          <AlertDescription>{queryError.message}</AlertDescription>
        </Alert>
      </SettingContainer>
    );
  }

  const availableCandidates = candidates.data?.candidates ?? [];
  const grouped = groupCandidates(availableCandidates);
  const selectItems = availableCandidates.map((candidate) => ({
    label: `${candidate.modelName} (${candidate.modelId})`,
    value: encodeSelection(candidate.providerKey, candidate.modelKey),
  }));
  const currentSelection =
    current.data?.providerKey === undefined || current.data.modelKey === undefined
      ? ''
      : encodeSelection(current.data.providerKey, current.data.modelKey);
  return (
    <SettingContainer>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t('settings.defaultModel.currentTitle', 'Current default model')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">
            {current.data?.providerId ?? t('settings.defaultModel.notConfigured', 'Not configured')} /{' '}
            {current.data?.modelId ?? t('settings.defaultModel.notConfigured', 'Not configured')}
          </span>
          {!current.data?.available && (
            <Badge variant="destructive">{t('settings.defaultModel.unavailable', 'Unavailable')}</Badge>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t('settings.defaultModel.selectTitle', 'Choose a default model')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void form.handleSubmit();
            }}
          >
            <FieldGroup>
              <form.Field
                name="selection"
                validators={{
                  onSubmit: ({ value }) =>
                    value.length === 0 ? t('settings.defaultModel.selectRequired', 'Select an available model.') : undefined,
                }}
              >
                {(field) => (
                  <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
                    <FieldLabel className="text-xs">{t('settings.defaultModel.fieldLabel', 'Provider / Model')}</FieldLabel>
                    <Select
                      items={selectItems}
                      value={field.state.value || null}
                      onValueChange={(value) => field.handleChange(value ?? '')}
                    >
                      <SelectTrigger
                        className="w-full"
                        aria-invalid={field.state.meta.errors.length > 0 || undefined}
                        onBlur={field.handleBlur}
                      >
                        <SelectValue placeholder={t('settings.defaultModel.selectPlaceholder', 'Select a default model')}>
                          {(value: string) =>
                            selectItems.find((item) => item.value === value)?.label ??
                            t('settings.defaultModel.selectPlaceholder', 'Select a default model')
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {[...grouped.entries()].map(([providerName, models]) => (
                          <SelectGroup key={providerName}>
                            <SelectLabel>{providerName}</SelectLabel>
                            {models.map((candidate) => (
                              <SelectItem
                                key={candidate.modelKey}
                                value={encodeSelection(candidate.providerKey, candidate.modelKey)}
                              >
                                {candidate.modelName} ({candidate.modelId})
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
                  </Field>
                )}
              </form.Field>
              {update.error instanceof Error ? (
                <Alert variant="destructive">
                  <AlertTitle>{t('settings.defaultModel.saveFailed', 'Save failed')}</AlertTitle>
                  <AlertDescription>{update.error.message}</AlertDescription>
                </Alert>
              ) : null}
              <form.Subscribe
                selector={(state) => ({
                  canSubmit: state.canSubmit,
                  isSubmitting: state.isSubmitting,
                  selection: state.values.selection,
                })}
              >
                {({ canSubmit, isSubmitting, selection }) => (
                  <Button
                    type="submit"
                    disabled={
                      !canSubmit ||
                      isSubmitting ||
                      update.isPending ||
                      selection.length === 0 ||
                      selection === currentSelection ||
                      (candidates.data?.candidates.length ?? 0) === 0
                    }
                  >
                    {isSubmitting || update.isPending ? <Spinner data-icon="inline-start" /> : null}
                    {t('settings.defaultModel.save', 'Save default model')}
                  </Button>
                )}
              </form.Subscribe>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </SettingContainer>
  );
}
