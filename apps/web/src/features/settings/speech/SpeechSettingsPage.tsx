/**
 * @author Codex
 * @description Configures independent speech providers and explicitly selects the service used by Composer.
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
import { speechProviderConfigSchema } from '@octopus/shared/protocol';
import { useSpeechSettings, useSaveSpeechSettings } from '@/queries/speech-queries';
import { PageTabList } from '@/components/PageTabList';
import { useI18n } from '@/i18n/use-i18n';
import { SettingContainer } from '../Layout/SettingContainer';
import type { SpeechProviderId, SpeechSettingsDto, SpeechSettingsUpdate } from '@octopus/shared/protocol';

interface SpeechSettingsPageProps {
  provider?: SpeechProviderId;
  /**
   * Keeps the viewed configuration in the Settings URL without activating it.
   */
  onProviderChange(provider: SpeechProviderId): void;
}

/**
 * Loads settings and resets drafts only after the user explicitly reloads them.
 */
export function SpeechSettingsPage(props: SpeechSettingsPageProps) {
  const { t } = useI18n();
  const settings = useSpeechSettings();
  const [generation, setGeneration] = useState(0);
  return (
    <SettingContainer>
      {settings.isPending && <Skeleton className="h-64 w-full" />}
      {settings.error && (
        <div role="alert" className="flex flex-col gap-3 text-sm text-destructive">
          {t('speech.loadFailed', 'Could not load speech settings.')}
          <Button variant="outline" onClick={() => void settings.refetch()}>
            {t('speech.reload', 'Reload settings')}
          </Button>
        </div>
      )}
      {settings.data && (
        <SpeechSettingsEditor
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
function SpeechSettingsEditor({
  settings,
  provider,
  onProviderChange,
  onReload,
}: SpeechSettingsPageProps & {
  settings: SpeechSettingsDto;
  /**
   * Reloads persisted settings and discards local drafts after explicit recovery.
   */
  onReload(): Promise<void>;
}) {
  const { t } = useI18n();
  const mutation = useSaveSpeechSettings();
  const revision = useRef(settings.revision);
  const [initial] = useState(settings);
  const labels = { openai: t('speech.openai', 'OpenAI compatible'), qwen: t('speech.qwen', 'Qwen Bailian') };
  /**
   * Advances the shared revision only after an acknowledged local write.
   */
  async function save(change: Omit<SpeechSettingsUpdate, 'revision'>) {
    const next = await mutation.mutateAsync({ ...change, revision: revision.current });
    revision.current = next.revision;
    return next;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('speech.title', 'Speech service')}</CardTitle>
        <CardDescription>
          {t(
            'speech.description',
            'Record in the Composer and turn speech into an editable draft. Audio is sent to your configured service only when you finish recording.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Field orientation="horizontal">
          <FieldLabel htmlFor="speech-enabled">{t('speech.enabled', 'Enable voice input')}</FieldLabel>
          <Switch
            id="speech-enabled"
            checked={settings.enabled}
            disabled={mutation.isPending}
            onCheckedChange={(enabled) => void save({ enabled }).catch(() => undefined)}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-2 text-sm" role="status">
          <Badge variant={settings.enabled ? 'secondary' : 'outline'}>
            {settings.enabled ? t('speech.on', 'On') : t('speech.off', 'Off')}
          </Badge>
          <span>
            {t('speech.selected', 'Selected service:')} {labels[settings.activeProvider]}
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
            aria-label="Speech providers"
            items={[
              { value: 'openai', label: labels.openai },
              { value: 'qwen', label: labels.qwen },
            ]}
          />
          <p className="py-2 text-xs text-muted-foreground">
            {t(
              'speech.tabsHelp',
              'Each service keeps its own configuration. Viewing a tab does not switch the selected service.'
            )}
          </p>
          {(['openai', 'qwen'] as const).map((id) => (
            <TabsContent key={id} value={id} keepMounted>
              <SpeechProviderForm
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
              {t('speech.reload', 'Reload settings')}
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
function SpeechProviderForm({
  id,
  initial,
  settings,
  pending,
  onSave,
}: {
  id: SpeechProviderId;
  initial: SpeechSettingsDto;
  settings: SpeechSettingsDto;
  pending: boolean;
  /**
   * Saves one provider, optionally selecting it in the same atomic update.
   */
  onSave(change: Omit<SpeechSettingsUpdate, 'revision'>): Promise<SpeechSettingsDto>;
}) {
  const { t } = useI18n();
  const [saved, setSaved] = useState(false);
  const activate = useRef(false);
  const isSelected = settings.activeProvider === id;
  const config = settings.providers[id];
  const prefix = `speech-${id}`;
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
              speechProviderConfigSchema.shape.baseUrl.safeParse(value).success
                ? undefined
                : t(
                    'speech.invalidUrl',
                    'Enter an HTTP(S) API base URL without credentials, query or fragment.'
                  ),
          }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0}>
              <FieldLabel htmlFor={`${prefix}-url`}>{t('speech.baseUrl', 'API base URL')}</FieldLabel>
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
                      'speech.qwenUrlHelp',
                      'Use the Bailian API base URL for your API key’s region. Beijing is prefilled; workspace URLs ending in /api/v1 are also supported.'
                    )
                  : t(
                      'speech.protocol',
                      'OpenAI-compatible Audio Transcriptions API. Include the API version path, for example /v1.'
                    )}
              </FieldDescription>
              <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
            </Field>
          )}
        </form.Field>
        <form.Field
          name="model"
          validators={{
            onSubmit: ({ value }) =>
              speechProviderConfigSchema.shape.model.safeParse(value).success
                ? undefined
                : t('speech.modelRequired', 'Enter an ASR model name (up to 200 characters).'),
          }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0}>
              <FieldLabel htmlFor={`${prefix}-model`}>{t('speech.model', 'ASR model')}</FieldLabel>
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
                    'speech.qwenModelHelp',
                    'Supports qwen-audio-3.1-asr-flash using the Bailian speech recognition API.'
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
              const required = id === 'qwen' && settings.enabled && (isSelected || activate.current);
              return required && !value.trim() && (!config.hasApiKey || form.getFieldValue('clearKey'))
                ? t('speech.keyRequired', 'Add a Qwen API key before enabling this service.')
                : undefined;
            },
          }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0}>
              <FieldLabel htmlFor={`${prefix}-key`}>{t('speech.apiKey', 'API Key')}</FieldLabel>
              <Input
                id={`${prefix}-key`}
                name={`${prefix}-key`}
                className="text-foreground motion-reduce:transition-none"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                placeholder={
                  config.hasApiKey
                    ? t('speech.keyConfigured', '******** (configured)')
                    : t('speech.keyPlaceholder', 'Enter an API key if required')
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
                      'speech.qwenKeyHelp',
                      'A Bailian API key is required. Leave blank to keep this service’s saved key.'
                    )
                  : t(
                      'speech.keyHelp',
                      'Leave blank to keep the saved key. Services without authentication can leave this empty.'
                    )}
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
                  {t('speech.clearKey', 'Remove saved API key on save')}
                </FieldLabel>
              </Field>
            )}
          </form.Field>
        )}
      </FieldGroup>
      {saved && (
        <p role="status" className="text-sm text-success">
          {t('speech.saved', 'Speech settings saved.')}
        </p>
      )}
      {!settings.enabled && (
        <p className="text-xs text-muted-foreground">
          {t(
            'speech.offHelp',
            'Voice input is off. You can configure and select a service, then turn it on above.'
          )}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="submit" variant={isSelected ? 'default' : 'outline'} disabled={pending}>
          {pending ? t('speech.saving', 'Saving…') : t('speech.save', 'Save settings')}
        </Button>
        {!isSelected && (
          <Button type="submit" data-activate="true" disabled={pending}>
            {pending ? t('speech.saving', 'Saving…') : t('speech.saveAndUse', 'Save and use')}
          </Button>
        )}
      </div>
    </form>
  );
}
