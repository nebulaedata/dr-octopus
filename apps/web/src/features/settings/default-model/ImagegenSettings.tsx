/**
 * @author Codex
 * @description Configures the next-call image model independently from conversation defaults.
 */
import { useEffect } from 'react';
import { useForm } from '@tanstack/react-form';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@octopus/ui/components/card';
import { Button } from '@octopus/ui/components/button';
import { Checkbox } from '@octopus/ui/components/checkbox';
import { Field, FieldLabel, FieldError } from '@octopus/ui/components/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@octopus/ui/components/select';
import { Skeleton } from '@octopus/ui/components/skeleton';
import { toast } from '@octopus/ui/components/toast';
import { useImagegenSettings, useSaveImagegenSettings } from '@/queries/imagegen-queries';
import { useI18n } from '@/i18n/use-i18n';

/**
 * Shows explicit protocol confirmation for custom services and preserves unavailable saved defaults.
 */
export function ImagegenSettings() {
  const { t } = useI18n();
  const { current, candidates } = useImagegenSettings();
  const save = useSaveImagegenSettings();
  const entries = candidates.data?.candidates ?? [];
  const config = current.data?.config;
  const form = useForm({
    defaultValues: {
      selection: config ? JSON.stringify([config.providerId, config.modelId]) : '',
      confirmed: config?.adapter === 'openai-images',
    },
    onSubmit: async ({ value }) => {
      const selected = entries.find(
        (item) => JSON.stringify([item.providerId, item.modelId]) === value.selection
      );
      if (!selected || (selected.requiresProtocolConfirmation && !value.confirmed)) {
        return;
      }
      await save.mutateAsync({
        providerId: selected.providerId,
        modelId: selected.modelId,
        adapter: selected.adapter,
      });
      toast.add({ title: t('settings.imagegen.saved', 'Image model updated'), type: 'success' });
    },
  });
  useEffect(() => {
    form.reset({
      selection: config ? JSON.stringify([config.providerId, config.modelId]) : '',
      confirmed: config?.adapter === 'openai-images',
    });
  }, [config, form]);
  const items = entries.map((item) => ({
    value: JSON.stringify([item.providerId, item.modelId]),
    label: `${item.providerName} / ${item.name}${!item.available ? ` · ${t('settings.imagegen.unavailable', 'Unavailable')}` : ''}`,
  }));
  const savedValue = config ? JSON.stringify([config.providerId, config.modelId]) : '';
  const missingSavedItem =
    config && !items.some((item) => item.value === savedValue)
      ? {
          value: savedValue,
          label: `${config.providerId} / ${config.modelId} · ${t('settings.imagegen.unavailable', 'Unavailable')}`,
        }
      : null;
  if (missingSavedItem) {
    items.push(missingSavedItem);
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t('settings.imagegen.title', 'Image model')}</CardTitle>
        <CardDescription>
          {t(
            'settings.imagegen.description',
            'Used for image generation and reference image editing. Changes apply to the next image request.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {current.isPending || candidates.isPending ? <Skeleton className="h-10 w-full" /> : null}
        {current.error || candidates.error ? (
          <p role="alert" className="text-sm text-destructive">
            {t('settings.imagegen.loadFailed', 'Could not load image model settings.')}
          </p>
        ) : null}
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit().catch(() => undefined);
          }}
        >
          <form.Field
            name="selection"
            validators={{
              onSubmit: ({ value }) =>
                value ? undefined : t('settings.imagegen.required', 'Choose an available image model.'),
            }}
          >
            {(field) => (
              <Field>
                <FieldLabel htmlFor="imagegen-model">
                  {t('settings.imagegen.model', 'Provider / image model')}
                </FieldLabel>
                <Select
                  items={items}
                  value={field.state.value || null}
                  onValueChange={(value) => {
                    field.handleChange(value ?? '');
                    form.setFieldValue('confirmed', false);
                  }}
                >
                  <SelectTrigger id="imagegen-model" className="w-full min-w-0" onBlur={field.handleBlur}>
                    <SelectValue placeholder={t('settings.imagegen.choose', 'Choose an image model')}>
                      <span className="truncate">
                        {items.find((item) => item.value === field.state.value)?.label ??
                          t('settings.imagegen.choose', 'Choose an image model')}
                      </span>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {missingSavedItem && (
                      <SelectItem value={missingSavedItem.value} disabled>
                        {missingSavedItem.label}
                      </SelectItem>
                    )}
                    {entries.map((item) => (
                      <SelectItem
                        key={JSON.stringify([item.providerId, item.modelId])}
                        value={JSON.stringify([item.providerId, item.modelId])}
                        disabled={!item.available}
                      >
                        {item.providerName} / {item.name} ·{' '}
                        {item.supportsReferenceImages
                          ? t('settings.imagegen.editing', 'Reference images supported')
                          : t('settings.imagegen.textOnly', 'Text to image only')}
                        {!item.available ? ` · ${t('settings.imagegen.unavailable', 'Unavailable')}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
              </Field>
            )}
          </form.Field>
          <form.Subscribe selector={(state) => state.values}>
            {({ selection, confirmed }) => {
              const selected = entries.find(
                (item) => JSON.stringify([item.providerId, item.modelId]) === selection
              );
              return (
                <>
                  {selected?.requiresProtocolConfirmation && (
                    <form.Field name="confirmed">
                      {(field) => (
                        <Field orientation="horizontal">
                          <Checkbox
                            id="imagegen-protocol"
                            checked={field.state.value}
                            onCheckedChange={(checked) => field.handleChange(checked === true)}
                          />
                          <FieldLabel htmlFor="imagegen-protocol">
                            {t(
                              'settings.imagegen.protocol',
                              'Use the OpenAI Images protocol for this service (generation and edits).'
                            )}
                          </FieldLabel>
                        </Field>
                      )}
                    </form.Field>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="submit"
                      disabled={
                        save.isPending ||
                        !selected?.available ||
                        (selected.requiresProtocolConfirmation && !confirmed)
                      }
                    >
                      {t('settings.imagegen.save', 'Save image model')}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={save.isPending || !config}
                      onClick={() => {
                        save.mutate(null);
                      }}
                    >
                      {t('settings.imagegen.clear', 'Clear image model')}
                    </Button>
                  </div>
                </>
              );
            }}
          </form.Subscribe>
        </form>
        {!entries.length && !candidates.isPending && (
          <p className="text-sm text-muted-foreground">
            {t(
              'settings.imagegen.noCandidates',
              'Configure a supported provider and mark its model as image generation in Model providers.'
            )}
          </p>
        )}
        {save.error && (
          <p role="alert" className="text-sm text-destructive">
            {save.error.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
