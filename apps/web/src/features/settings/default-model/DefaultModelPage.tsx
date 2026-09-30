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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@octopus/ui/components/card';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@octopus/ui/components/field';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@octopus/ui/components/combobox';
import { Skeleton } from '@octopus/ui/components/skeleton';
import { Spinner } from '@octopus/ui/components/spinner';
import { toast } from '@octopus/ui/components/toast';
import { useDefaultModelSettings, useUpdateDefaultModel } from '@/queries/settings-queries';
import { useI18n } from '@/i18n/use-i18n';

interface DefaultModelFormValues {
  selection: string;
}

/**
 * Encodes two opaque keys into one selection value without exposing Provider IDs.
 *
 * @param providerKey Opaque Provider key.
 * @param modelKey Opaque model key.
 * @returns Selection-safe JSON value.
 */
function encodeSelection(providerKey: string, modelKey: string): string {
  return JSON.stringify([providerKey, modelKey]);
}

/**
 * Decodes the selected opaque pair.
 *
 * @param selection selection value emitted by the form.
 * @returns Provider and model keys.
 */
function decodeSelection(selection: string): { providerKey: string; modelKey: string } {
  const [providerKey, modelKey] = JSON.parse(selection) as [string, string];
  return { providerKey, modelKey };
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
  const selectItems = availableCandidates.map((candidate) => ({
    label: `${candidate.providerName} / ${candidate.modelName} (${candidate.modelId})`,
    modelName: candidate.modelName,
    modelId: candidate.modelId,
    providerName: candidate.providerName,
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
          <CardTitle className="text-sm">
            {t('settings.defaultModel.selectTitle', 'Choose a default model')}
          </CardTitle>
          <CardDescription>
            {t(
              'settings.defaultModel.description',
              'Choose the model used by new sessions. Existing sessions keep their current model.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
            <span className="text-xs text-muted-foreground">
              {t('settings.defaultModel.currentTitle', 'Current default model')}
            </span>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="break-all text-sm font-medium">
                {current.data?.providerId ?? t('settings.defaultModel.notConfigured', 'Not configured')}
                {current.data?.modelId ? ` / ${current.data.modelId}` : ''}
              </span>
              {currentSelection && !current.data?.available ? (
                <Badge variant="destructive">{t('settings.defaultModel.unavailable', 'Unavailable')}</Badge>
              ) : null}
            </div>
          </div>
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
                    value.length === 0
                      ? t('settings.defaultModel.selectRequired', 'Select an available model.')
                      : undefined,
                }}
              >
                {(field) => (
                  <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
                    <FieldLabel htmlFor="default-model-selection">
                      {t('settings.defaultModel.fieldLabel', 'Provider / Model')}
                    </FieldLabel>
                    <Combobox
                      items={selectItems}
                      value={selectItems.find((item) => item.value === field.state.value) ?? null}
                      onValueChange={(item) => field.handleChange(item?.value ?? '')}
                      itemToStringLabel={(item) => item.label}
                      itemToStringValue={(item) => item.value}
                      isItemEqualToValue={(item, value) => item.value === value.value}
                      disabled={update.isPending || selectItems.length === 0}
                    >
                      <ComboboxInput
                        id="default-model-selection"
                        className="w-full"
                        placeholder={t(
                          'settings.defaultModel.searchPlaceholder',
                          'Search provider, model name or ID'
                        )}
                        aria-invalid={field.state.meta.errors.length > 0 || undefined}
                        onBlur={field.handleBlur}
                      />
                      <ComboboxContent>
                        <ComboboxEmpty>
                          {t('settings.defaultModel.noMatches', 'No matching models')}
                        </ComboboxEmpty>
                        <ComboboxList>
                          {(item: (typeof selectItems)[number]) => (
                            <ComboboxItem key={item.value} value={item}>
                              <div className="flex min-w-0 flex-col gap-0.5 py-1">
                                <span className="truncate" title={item.modelName}>
                                  {item.modelName}
                                </span>
                                <span
                                  className="truncate text-xs text-muted-foreground"
                                  title={`${item.providerName} / ${item.modelId}`}
                                >
                                  {item.providerName} / {item.modelId}
                                </span>
                              </div>
                            </ComboboxItem>
                          )}
                        </ComboboxList>
                      </ComboboxContent>
                    </Combobox>
                    {selectItems.length === 0 ? (
                      <FieldDescription>
                        {t(
                          'settings.defaultModel.noCandidates',
                          'Configure an available model in Model services first.'
                        )}
                      </FieldDescription>
                    ) : null}
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
                  <div className="flex justify-end">
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
                  </div>
                )}
              </form.Subscribe>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </SettingContainer>
  );
}
