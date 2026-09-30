/**
 * @author Codex
 * @description Configures independent imagegen providers and explicitly selects the service used by image tool.
 */
import { useForm } from '@tanstack/react-form';
import { useRef, useState } from 'react';
import { Button } from '@octopus/ui/components/button';
import { Badge } from '@octopus/ui/components/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@octopus/ui/components/card';
import { Field, FieldGroup, FieldLabel, FieldError, FieldDescription } from '@octopus/ui/components/field';
import { Input } from '@octopus/ui/components/input';
import { Switch } from '@octopus/ui/components/switch';
import { Checkbox } from '@octopus/ui/components/checkbox';
import { Skeleton } from '@octopus/ui/components/skeleton';
import { Tabs, TabsContent } from '@octopus/ui/components/tabs';
import { imagegenProviderConfigSchema } from '@octopus/shared/protocol';
import { useImagegenSettings, useSaveImagegenSettings } from '@/queries/imagegen-queries';
import { PageTabList } from '@/components/PageTabList';
import { useI18n } from '@/i18n/use-i18n';
import { SettingContainer } from '../Layout/SettingContainer';
import type {
  ImagegenProviderId,
  ImagegenSettingsDto,
  ImagegenSettingsUpdate,
} from '@octopus/shared/protocol';

interface ImagegenSettingsPageProps {
  provider?: ImagegenProviderId;
  /**
   * Keeps the viewed configuration in the Settings URL without activating it.
   */
  onProviderChange(provider: ImagegenProviderId): void;
}

/**
 * Loads settings and resets drafts only after the user explicitly reloads them.
 */
export function ImagegenSettingsPage(props: ImagegenSettingsPageProps) {
  const { t } = useI18n();
  const settings = useImagegenSettings();
  const [generation, setGeneration] = useState(0);
  return (
    <SettingContainer>
      {settings.isPending && <Skeleton className="h-64 w-full" />}
      {settings.error && (
        <div role="alert" className="flex flex-col gap-3 text-sm text-destructive">
          {t('imagegen.loadFailed', 'Could not load image settings.')}
          <Button variant="outline" onClick={() => void settings.refetch()}>
            {t('imagegen.reload', 'Reload settings')}
          </Button>
        </div>
      )}
      {settings.data && (
        <ImagegenSettingsEditor
          key={generation}
          {...props}
          settings={settings.data}
          onReload={async () => {
            const result = await settings.refetch();
            if (result.data && !result.error) {
              setGeneration((value) => value + 1);
            }
          }}
        />
      )}
    </SettingContainer>
  );
}

/**
 * Shares a revision across local saves; background refetches cannot silently overwrite concurrent edits.
 */
function ImagegenSettingsEditor({
  settings,
  provider,
  onProviderChange,
  onReload,
}: ImagegenSettingsPageProps & {
  settings: ImagegenSettingsDto;
  /**
   * Reloads persisted settings and discards local drafts after explicit recovery.
   */
  onReload(): Promise<void>;
}) {
  const { t } = useI18n();
  const mutation = useSaveImagegenSettings();
  const revision = useRef(settings.revision);
  const [initial] = useState(settings);
  const labels = { openai: t('imagegen.openai', 'OpenAI'), qwen: t('imagegen.qwen', 'Qwen Bailian') };
  /**
   * Advances the shared revision only after an acknowledged local write.
   */
  async function save(change: Omit<ImagegenSettingsUpdate, 'revision'>) {
    const next = await mutation.mutateAsync({ ...change, revision: revision.current });
    revision.current = next.revision;
    return next;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('imagegen.title', 'Image service')}</CardTitle>
        <CardDescription>
          {t(
            'imagegen.description',
            'Configure image generation independently from chat models. Changes apply to the next image request.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Field orientation="horizontal">
          <FieldLabel htmlFor="imagegen-enabled">
            {t('imagegen.enabled', 'Enable image generation')}
          </FieldLabel>
          <Switch
            id="imagegen-enabled"
            checked={settings.enabled}
            disabled={mutation.isPending}
            onCheckedChange={(enabled) => void save({ enabled }).catch(() => undefined)}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-2 text-sm" role="status">
          <Badge variant={settings.enabled ? 'secondary' : 'outline'}>
            {settings.enabled ? t('imagegen.on', 'On') : t('imagegen.off', 'Off')}
          </Badge>
          <span>
            {t('imagegen.selected', 'Selected service:')} {labels[settings.activeProvider]}
          </span>
          <span className="break-all text-xs text-muted-foreground">
            {settings.providers[settings.activeProvider].model}
          </span>
        </div>
        <Tabs
          value={provider ?? settings.activeProvider}
          onValueChange={(value) => {
            if (value === 'openai' || value === 'qwen') {
              onProviderChange(value);
            }
          }}
        >
          <PageTabList
            className="w-full"
            itemClassName="motion-reduce:transition-none"
            aria-label="Imagegen providers"
            items={[
              { value: 'openai', label: labels.openai },
              { value: 'qwen', label: labels.qwen },
            ]}
          />
          <p className="py-2 text-xs text-muted-foreground">
            {t(
              'imagegen.tabsHelp',
              'Each service keeps its own configuration. Viewing a tab does not switch the selected service.'
            )}
          </p>
          {(['openai', 'qwen'] as const).map((id) => (
            <TabsContent key={id} value={id} keepMounted>
              <ImagegenProviderForm
                id={id}
                initial={initial}
                settings={settings}
                pending={mutation.isPending}
                onSave={save}
              />
            </TabsContent>
          ))}
        </Tabs>
        {mutation.error && (
          <div role="alert" className="flex flex-col items-start gap-2 text-sm text-destructive">
            {mutation.error.message}
            <Button variant="outline" onClick={() => void onReload()}>
              {t('imagegen.reload', 'Reload settings')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Keeps provider drafts mounted across tab changes and never fills inputs with stored secrets.
 */
function ImagegenProviderForm({
  id,
  initial,
  settings,
  pending,
  onSave,
}: {
  id: ImagegenProviderId;
  initial: ImagegenSettingsDto;
  settings: ImagegenSettingsDto;
  pending: boolean;
  /**
   * Saves one provider, optionally selecting it in the same atomic update.
   */
  onSave(change: Omit<ImagegenSettingsUpdate, 'revision'>): Promise<ImagegenSettingsDto>;
}) {
  const { t } = useI18n();
  const [saved, setSaved] = useState(false);
  const activate = useRef(false);
  const isSelected = settings.activeProvider === id;
  const config = settings.providers[id];
  const prefix = `imagegen-${id}`;
  const [defaults, setDefaults] = useState({
    baseUrl: initial.providers[id].baseUrl,
    model: initial.providers[id].model,
    apiKey: '',
    clearKey: false,
  });
  const form = useForm({
    defaultValues: defaults,
    onSubmit: async ({ value }) => {
      setSaved(false);
      const next = await onSave({
        ...(activate.current ? { activeProvider: id } : {}),
        provider: {
          id,
          baseUrl: value.baseUrl,
          model: value.model,
          ...(value.clearKey ? { apiKey: null } : {}),
          ...(value.apiKey.trim() ? { apiKey: value.apiKey.trim() } : {}),
        },
      });
      const nextValues = {
        baseUrl: next.providers[id].baseUrl,
        model: next.providers[id].model,
        apiKey: '',
        clearKey: false,
      };
      setDefaults(nextValues);
      form.reset(nextValues);
      setSaved(true);
    },
    onSubmitInvalid: () =>
      document.querySelector<HTMLElement>(`#${prefix}-form [aria-invalid="true"]`)?.focus(),
  });
  return (
    <form
      id={`${prefix}-form`}
      className="flex flex-col gap-5"
      onChange={() => setSaved(false)}
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        activate.current =
          (event.nativeEvent as SubmitEvent).submitter?.getAttribute('data-activate') === 'true';
        void form.handleSubmit().catch(() => undefined);
      }}
    >
      <FieldGroup>
        <form.Field
          name="baseUrl"
          validators={{
            onSubmit: ({ value }) =>
              imagegenProviderConfigSchema.shape.baseUrl.safeParse(value).success
                ? undefined
                : t(
                    'imagegen.invalidUrl',
                    'Enter an HTTP(S) API base URL without credentials, query or fragment.'
                  ),
          }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0}>
              <FieldLabel htmlFor={`${prefix}-url`}>{t('imagegen.baseUrl', 'API base URL')}</FieldLabel>
              <Input
                id={`${prefix}-url`}
                name={`${prefix}-url`}
                className="text-foreground motion-reduce:transition-none"
                type="url"
                autoComplete="url"
                spellCheck={false}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                aria-invalid={field.state.meta.errors.length > 0}
                disabled={pending}
              />
              <FieldDescription>
                {id === 'qwen'
                  ? t(
                      'imagegen.qwenUrlHelp',
                      'Use the Bailian API base URL for your API key’s region. Beijing is prefilled; workspace URLs ending in /api/v1 are also supported.'
                    )
                  : t('imagegen.protocol', 'OpenAI Images API base URL, including /v1.')}
              </FieldDescription>
              <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
            </Field>
          )}
        </form.Field>
        <form.Field
          name="model"
          validators={{
            onSubmit: ({ value }) =>
              imagegenProviderConfigSchema.shape.model.safeParse(value).success
                ? undefined
                : t('imagegen.modelRequired', 'Enter an image generation model name (up to 200 characters).'),
          }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0}>
              <FieldLabel htmlFor={`${prefix}-model`}>{t('imagegen.model', 'Image model')}</FieldLabel>
              <Input
                id={`${prefix}-model`}
                name={`${prefix}-model`}
                className="text-foreground motion-reduce:transition-none"
                autoComplete="off"
                spellCheck={false}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                aria-invalid={field.state.meta.errors.length > 0}
                disabled={pending}
              />
              {id === 'qwen' && (
                <FieldDescription>
                  {t(
                    'imagegen.qwenModelHelp',
                    'Supports Qwen Image models using the Bailian image generation API.'
                  )}
                </FieldDescription>
              )}
              <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
            </Field>
          )}
        </form.Field>
        <form.Field
          name="apiKey"
          validators={{
            onSubmit: ({ value }) => {
              const required = settings.enabled && (isSelected || activate.current);
              return required && !value.trim() && (!config.hasApiKey || form.getFieldValue('clearKey'))
                ? t('imagegen.keyRequired', 'Add an API key before enabling this service.')
                : undefined;
            },
          }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0}>
              <FieldLabel htmlFor={`${prefix}-key`}>{t('imagegen.apiKey', 'API Key')}</FieldLabel>
              <Input
                id={`${prefix}-key`}
                name={`${prefix}-key`}
                className="text-foreground motion-reduce:transition-none"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                placeholder={
                  config.hasApiKey
                    ? t('imagegen.keyConfigured', '******** (configured)')
                    : t('imagegen.keyPlaceholder', 'Enter an API key')
                }
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  field.handleChange(event.target.value);
                  form.setFieldValue('clearKey', false);
                }}
                aria-invalid={field.state.meta.errors.length > 0}
                disabled={pending}
              />
              <FieldDescription>
                {id === 'qwen'
                  ? t(
                      'imagegen.qwenKeyHelp',
                      'A Bailian API key is required. Leave blank to keep this service’s saved key.'
                    )
                  : t('imagegen.keyHelp', 'Leave blank to keep this service’s saved API key.')}
              </FieldDescription>
              <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
            </Field>
          )}
        </form.Field>
        {config.hasApiKey && (
          <form.Field name="clearKey">
            {(field) => (
              <Field orientation="horizontal">
                <Checkbox
                  id={`${prefix}-clear-key`}
                  checked={field.state.value}
                  disabled={pending}
                  onCheckedChange={(value) => {
                    field.handleChange(value === true);
                    form.setFieldValue('apiKey', '');
                    setSaved(false);
                  }}
                />
                <FieldLabel htmlFor={`${prefix}-clear-key`}>
                  {t('imagegen.clearKey', 'Clear this service’s API key (takes effect after saving)')}
                </FieldLabel>
              </Field>
            )}
          </form.Field>
        )}
      </FieldGroup>
      {saved && (
        <p role="status" className="text-sm text-success">
          {t('imagegen.saved', 'Image settings saved.')}
        </p>
      )}
      {!settings.enabled && (
        <p className="text-xs text-muted-foreground">
          {t('imagegen.offHelp', 'Image generation is off. Configure a service, then turn it on above.')}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="submit" variant={isSelected ? 'default' : 'outline'} disabled={pending}>
          {pending ? t('imagegen.saving', 'Saving…') : t('imagegen.save', 'Save settings')}
        </Button>
        {!isSelected && (
          <Button type="submit" data-activate="true" disabled={pending}>
            {pending ? t('imagegen.saving', 'Saving…') : t('imagegen.saveAndUse', 'Save and use')}
          </Button>
        )}
      </div>
    </form>
  );
}
