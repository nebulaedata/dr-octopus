/**
 * @author Codex
 * @description Offers automatic relay matching and a single native Pi model correction without capability flags.
 */
import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { Settings2Icon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@octopus/ui/components/dialog';
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
} from '@octopus/ui/components/combobox';
import { Field, FieldLabel, FieldDescription } from '@octopus/ui/components/field';
import { Tooltip, TooltipTrigger, TooltipContent } from '@octopus/ui/components/tooltip';
import { Alert, AlertDescription } from '@octopus/ui/components/alert';
import { useModelAssociations, useUpdateModelAssociation } from '@/queries/model-association-queries';
import { useI18n } from '@/i18n/use-i18n';
import type { ModelSettingsDto, ModelAssociation } from '@octopus/shared/protocol';

/**
 * Keeps the row trigger mounted to preserve focus when the editor closes.
 */
export function ModelAssociationDialog({
  providerKey,
  model,
}: {
  providerKey: string;
  model: ModelSettingsDto;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          aria-label="Edit model association"
          render={<DialogTrigger render={<Button variant="ghost" size="icon-sm" />} />}
        >
          <Settings2Icon />
        </TooltipTrigger>
        <TooltipContent>{t('settings.providers.association.title', 'Model association')}</TooltipContent>
      </Tooltip>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settings.providers.association.title', 'Model association')}</DialogTitle>
          <DialogDescription className="break-all">{model.name}</DialogDescription>
        </DialogHeader>
        {open && <AssociationForm providerKey={providerKey} model={model} onSaved={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Saves only the chosen source; automatic matching is represented by null.
 */
function AssociationForm({
  providerKey,
  model,
  onSaved,
}: {
  providerKey: string;
  model: ModelSettingsDto;
  /**
   * Closes the editor after the association has been persisted.
   */
  onSaved(): void;
}) {
  const { t } = useI18n();
  const query = useModelAssociations(providerKey);
  const mutation = useUpdateModelAssociation(providerKey, model.modelKey);
  const form = useForm({
    defaultValues: { source: model.association ? JSON.stringify(model.association) : 'auto' },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync({
        source: value.source === 'auto' ? null : (JSON.parse(value.source) as ModelAssociation),
      });
      onSaved();
    },
  });
  const options = [
    { value: 'auto', label: t('settings.providers.association.auto', 'Automatic matching') },
    ...(query.data?.candidates ?? []).map(({ providerId, modelId }) => ({
      value: JSON.stringify({ providerId, modelId }),
      label: `${providerId} / ${modelId}`,
    })),
  ];
  const missingSource =
    model.association && !options.some((option) => option.value === JSON.stringify(model.association));
  if (missingSource && model.association) {
    options.push({
      value: JSON.stringify(model.association),
      label: `${model.association.providerId} / ${model.association.modelId}`,
    });
  }
  const unmatchedReasons = {
    not_found: t(
      'settings.providers.association.notFound',
      'Not associated: no original model with the same ID was found.'
    ),
    ambiguous: t(
      'settings.providers.association.ambiguous',
      'Not associated: more than one original model matches. Select the correct one.'
    ),
    incomplete: t(
      'settings.providers.association.incomplete',
      'Not associated: the original model lacks the required compatibility settings.'
    ),
  };
  let associationStatus = t('settings.providers.association.notAssociated', 'Not associated');
  if (model.adaptation?.status === 'adapted') {
    associationStatus = t('settings.providers.association.savedSource', 'Saved association: {{model}}', {
      model: `${model.adaptation.source.providerId} / ${model.adaptation.source.modelId}`,
    });
  } else if (model.adaptation?.status === 'unadapted') {
    associationStatus = unmatchedReasons[model.adaptation.reason];
  }
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit().catch(() => undefined);
      }}
    >
      <FieldDescription className="break-all">{associationStatus}</FieldDescription>
      <form.Field name="source">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="relay-model-source">
              {t('settings.providers.association.source', 'Original model')}
            </FieldLabel>
            <Combobox
              items={options}
              value={options.find((option) => option.value === field.state.value) ?? null}
              onValueChange={(option) => field.handleChange(option?.value ?? 'auto')}
              itemToStringLabel={(option) => option.label}
              itemToStringValue={(option) => option.value}
              isItemEqualToValue={(option, value) => option.value === value.value}
              disabled={query.isPending || mutation.isPending}
            >
              <ComboboxInput
                id="relay-model-source"
                className="w-full"
                placeholder={t('settings.providers.association.search', 'Search provider or model')}
              />
              <ComboboxContent>
                <ComboboxEmpty>
                  {t('settings.providers.association.empty', 'No matching models')}
                </ComboboxEmpty>
                <ComboboxList>
                  {(option: { value: string; label: string }) => (
                    <ComboboxItem key={option.value} value={option}>
                      {option.label}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
            <FieldDescription>
              {t(
                'settings.providers.association.hint',
                'Automatic matching finds the same model ID. If no match is found, the model stays unavailable. You can select the corresponding original model manually.'
              )}
            </FieldDescription>
          </Field>
        )}
      </form.Field>
      {(query.error || mutation.error) && (
        <Alert variant="destructive">
          <AlertDescription>{(query.error ?? mutation.error)?.message}</AlertDescription>
        </Alert>
      )}
      {query.error && (
        <Button type="button" variant="outline" onClick={() => void query.refetch()}>
          {t('settings.providers.association.retry', 'Retry')}
        </Button>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={query.isPending || Boolean(query.error) || mutation.isPending}>
          {mutation.isPending
            ? t('settings.providers.local.saving', 'Saving…')
            : t('settings.providers.association.save', 'Save association')}
        </Button>
      </div>
    </form>
  );
}
