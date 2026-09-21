/**
 * @author Codex
 * @description Edits Pi reasoning and image-input metadata for a custom model without discarding failed drafts.
 */
import { useState } from 'react';
import { Settings2Icon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@octopus/ui/components/tooltip';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@octopus/ui/components/button';
import { Checkbox } from '@octopus/ui/components/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@octopus/ui/components/dialog';
import { Field, FieldGroup, FieldLabel } from '@octopus/ui/components/field';
import { Alert, AlertDescription } from '@octopus/ui/components/alert';
import { updateModelCapabilities } from '@/api/model-capabilities';
import { queryKeys } from '@/queries/query-keys';
import { useI18n } from '@/i18n/use-i18n';
import type { ModelSettingsDto, UpdateModelCapabilitiesBody } from '@octopus/shared/protocol';

/**
 * Keeps the trigger mounted so closing the editor restores keyboard focus to its model row.
 */
export function ModelCapabilitiesDialog({
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
          aria-label="Edit capabilities"
          render={<DialogTrigger render={<Button variant="ghost" size="icon" />} />}
        >
          <Settings2Icon />
        </TooltipTrigger>
        <TooltipContent>{t('settings.providers.editCapabilities', 'Edit capabilities')}</TooltipContent>
      </Tooltip>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settings.providers.modelCapabilities', 'Model capabilities')}</DialogTitle>
          <DialogDescription className="break-all">{model.name}</DialogDescription>
        </DialogHeader>
        {open && (
          <ModelCapabilitiesForm providerKey={providerKey} model={model} onSaved={() => setOpen(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Persists the declared capabilities and refreshes provider and model-selection caches.
 */
function ModelCapabilitiesForm({
  providerKey,
  model,
  onSaved,
}: {
  providerKey: string;
  model: ModelSettingsDto;
  /**
   * Closes the editor after a confirmed save.
   */
  onSaved(): void;
}) {
  const { t } = useI18n();
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: UpdateModelCapabilitiesBody) =>
      updateModelCapabilities(providerKey, model.modelKey, input),
    onSuccess: async (provider) => {
      client.setQueryData(queryKeys.modelProvider(providerKey), provider);
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.modelProvidersRoot }),
        client.invalidateQueries({ queryKey: queryKeys.defaultModel }),
      ]);
      onSaved();
    },
  });
  const form = useForm({
    defaultValues: { reasoning: model.reasoning, image: model.input.includes('image') },
    onSubmit: async ({ value }) => {
      try {
        await mutation.mutateAsync({
          reasoning: value.reasoning,
          input: value.image ? ['text', 'image'] : ['text'],
        });
      } catch {
        // The inline error preserves the draft for retry.
      }
    },
  });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.Field name="reasoning">
          {(field) => (
            <Field orientation="horizontal">
              <Checkbox
                id="model-capability-reasoning"
                name={field.name}
                checked={field.state.value}
                onCheckedChange={(checked) => field.handleChange(checked === true)}
                onBlur={field.handleBlur}
                disabled={mutation.isPending}
              />
              <FieldLabel htmlFor="model-capability-reasoning">
                {t('settings.providers.reasoning', 'Supports reasoning')}
              </FieldLabel>
            </Field>
          )}
        </form.Field>
        <form.Field name="image">
          {(field) => (
            <Field orientation="horizontal">
              <Checkbox
                id="model-capability-image"
                name={field.name}
                checked={field.state.value}
                onCheckedChange={(checked) => field.handleChange(checked === true)}
                onBlur={field.handleBlur}
                disabled={mutation.isPending}
              />
              <FieldLabel htmlFor="model-capability-image">
                {t('settings.providers.imageInput', 'Supports image input')}
              </FieldLabel>
            </Field>
          )}
        </form.Field>
      </FieldGroup>
      <p className="text-sm text-muted-foreground">
        {t(
          'settings.providers.capabilityHelp',
          'Declare capabilities supported by this model. Available thinking levels are determined by Pi. Existing sessions may need to restart to use the updated configuration.'
        )}
      </p>
      {mutation.error && (
        <Alert variant="destructive">
          <AlertDescription>{mutation.error.message}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending
          ? t('settings.providers.local.saving', 'Saving…')
          : t('settings.providers.local.save', 'Save configuration')}
      </Button>
    </form>
  );
}
