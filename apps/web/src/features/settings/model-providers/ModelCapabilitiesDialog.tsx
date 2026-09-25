/**
 * @author Codex
 * @description Edits custom model capabilities without discarding failed drafts.
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@octopus/ui/components/field';
import { ToggleButtonGroup } from '@/components/ToggleButtonGroup';
import { Alert, AlertDescription } from '@octopus/ui/components/alert';
import { updateModelCapabilities } from '@/api/model-capabilities';
import { queryKeys } from '@/queries/core/query-keys';
import { useI18n } from '@/i18n/use-i18n';
import type { ModelInterface, ModelSettingsDto, UpdateModelCapabilitiesBody } from '@octopus/shared/protocol';

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
          render={<DialogTrigger render={<Button variant="ghost" size="icon-sm" />} />}
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
        client.invalidateQueries({ queryKey: queryKeys.imagegen }),
        client.invalidateQueries({ queryKey: ['conversation-models'] }),
        client.invalidateQueries({ queryKey: queryKeys.bootstrapRoot }),
      ]);
      onSaved();
    },
  });
  let interfaceType = 'chat';
  if (model.interfaces.includes('other')) {
    interfaceType = 'other';
  } else if (!model.interfaces.includes('chat')) {
    interfaceType = 'image';
  } else if (model.interfaces.includes('image')) {
    interfaceType = 'both';
  }
  const form = useForm({
    defaultValues: {
      reasoning: model.reasoning,
      image: model.input.includes('image'),
      imageGeneration: model.capabilities.includes('image_generation'),
      interfaceType,
    },
    onSubmit: async ({ value }) => {
      let interfaces: ModelInterface[] = ['chat'];
      if (value.interfaceType === 'other') {
        interfaces = ['other'];
      } else if (value.interfaceType === 'image') {
        interfaces = ['image'];
      } else if (value.interfaceType === 'both') {
        interfaces = ['chat', 'image'];
      }
      try {
        await mutation.mutateAsync({
          reasoning: value.reasoning,
          input: value.image ? ['text', 'image'] : ['text'],
          imageGeneration: value.imageGeneration,
          interfaces,
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
        <form.Field name="interfaceType">
          {(field) => (
            <Field>
              <FieldLabel>{t('settings.providers.modelInterfaces', 'Model interfaces')}</FieldLabel>
              <ToggleButtonGroup
                className="flex-wrap"
                ariaLabel="Model interfaces"
                selectedKey={field.state.value}
                onSelectedKeyChange={field.handleChange}
                options={[
                  {
                    key: 'chat',
                    label: t('settings.providers.chatInterface', 'Chat'),
                    disabled: mutation.isPending,
                  },
                  {
                    key: 'image',
                    label: t('settings.providers.imageInterface', 'Image generation'),
                    disabled: mutation.isPending,
                  },
                  {
                    key: 'both',
                    label: t('settings.providers.bothInterfaces', 'Chat and image generation'),
                    disabled: mutation.isPending,
                  },
                  {
                    key: 'other',
                    label: t('settings.providers.otherInterface', 'Other'),
                    disabled: mutation.isPending,
                  },
                ]}
              />
              <FieldDescription>
                {t(
                  'settings.providers.modelInterfacesHint',
                  'Only models supporting chat can be selected for agents.'
                )}
              </FieldDescription>
            </Field>
          )}
        </form.Field>
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
                {t('settings.providers.reasoning', 'Reasoning')}
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
                {t('settings.providers.imageInput', 'Image input')}
              </FieldLabel>
            </Field>
          )}
        </form.Field>
        <form.Field name="imageGeneration">
          {(field) => (
            <Field orientation="horizontal">
              <Checkbox
                id="model-capability-image-generation"
                name={field.name}
                checked={field.state.value}
                onCheckedChange={(checked) => field.handleChange(checked === true)}
                onBlur={field.handleBlur}
                disabled={mutation.isPending}
              />
              <FieldLabel htmlFor="model-capability-image-generation">
                {t('settings.providers.imageGeneration', 'Image generation')}
              </FieldLabel>
            </Field>
          )}
        </form.Field>
      </FieldGroup>
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
