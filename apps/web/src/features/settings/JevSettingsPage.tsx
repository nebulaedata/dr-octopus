/**
 * @author Codex
 * @description Configures Jev model and environment credentials independently of consumer policies.
 */
import { useRef } from 'react';
import { useSafeState } from 'ahooks';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@octopus/ui/components/card';
import { Field, FieldDescription, FieldLabel, FieldGroup } from '@octopus/ui/components/field';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '@octopus/ui/components/select';
import { Input } from '@octopus/ui/components/input';
import { Button } from '@octopus/ui/components/button';
import { Alert, AlertDescription } from '@octopus/ui/components/alert';
import { toast } from '@octopus/ui/components/toast';
import { jevSettingsUpdateSchema } from '@octopus/shared/protocol';
import { jevSettingsQuery, jevModelsQuery } from '@/queries/jev-queries';
import { probeJev, saveJevSettings, saveJevCredential } from '@/api/jev';
import { useI18n } from '@/i18n/use-i18n';
import { SettingContainer } from './Layout/SettingContainer';
import type { JevSettingsSnapshot, JevSettingsUpdate } from '@octopus/shared/protocol';

/**
 * Share the same page across canonical and route-masked Settings navigation.
 */
export function JevSettingsPage() {
  const { t } = useI18n();
  const query = useQuery(jevSettingsQuery());
  return (
    <SettingContainer>
      {query.isPending && <p role="status">{t('settings.jev.loading', 'Loading Jev settings…')}</p>}
      {query.error && (
        <Alert variant="destructive">
          <AlertDescription>{query.error.message}</AlertDescription>
        </Alert>
      )}
      {query.data && (
        <>
          <JevCredentialForm key={query.data.environmentRevision} settings={query.data} />
          <JevSettingsForm key={query.data.revision} settings={query.data} />
        </>
      )}
    </SettingContainer>
  );
}

/**
 * Edit the shared model while credentials remain owned by Agent environment settings.
 */
function JevSettingsForm({ settings }: { settings: JevSettingsSnapshot }) {
  const { t } = useI18n();
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: saveJevSettings,
    gcTime: 0,
    onSuccess: (next) => {
      client.setQueryData(jevSettingsQuery().queryKey, next);
      toast.add({ title: t('settings.jev.saved', 'Jev settings saved'), type: 'success' });
    },
  });
  const models = useQuery({ ...jevModelsQuery(settings.environmentRevision), enabled: settings.hasApiKey });
  const modelOptions = [...new Set([settings.model, ...(settings.hasApiKey ? (models.data ?? []) : [])])];
  const probe = useMutation({ mutationFn: probeJev, retry: false });
  const defaultValues: JevSettingsUpdate = {
    revision: settings.revision,
    model: settings.model,
  };
  const form = useForm({
    defaultValues,
    validators: {
      onSubmit: ({ value }) => {
        if (!jevSettingsUpdateSchema.safeParse(value).success) {
          return t('settings.jev.invalid', 'Enter a valid Jev model ID.');
        }
        return undefined;
      },
    },
    onSubmit: async ({ value }) => {
      const next = await mutation.mutateAsync(value);
      form.reset({ ...value, revision: next.revision });
    },
  });
  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit().catch(() => undefined);
      }}
    >
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>{t('settings.jev.title', 'Jev')}</CardTitle>
          <CardDescription>{t('settings.jev.description', 'TypeSafe model configuration.')}</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <form.Field name="model">
              {(field) => {
                const options = [...new Set([field.state.value, ...modelOptions])];
                return (
                  <Field>
                    <FieldLabel htmlFor="jev-model">{t('settings.jev.model', 'Model')}</FieldLabel>
                    <Select
                      name={field.name}
                      value={field.state.value}
                      items={options.map((model) => ({ value: model, label: model }))}
                      onValueChange={(value) => {
                        if (value) {
                          field.handleChange(value);
                        }
                      }}
                    >
                      <SelectTrigger id="jev-model" className="w-full" onBlur={field.handleBlur}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {options.map((model) => (
                            <SelectItem key={model} value={model}>
                              {model}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    {!settings.hasApiKey && (
                      <FieldDescription>
                        {t('settings.jev.modelsKeyRequired', 'Save an API key to load models.')}
                      </FieldDescription>
                    )}
                    {models.isFetching && (
                      <FieldDescription role="status">
                        {t('settings.jev.modelsLoading', 'Loading models…')}
                      </FieldDescription>
                    )}
                    {settings.hasApiKey && models.error && (
                      <Alert variant="destructive">
                        <AlertDescription>
                          {models.error.message}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void models.refetch()}
                            disabled={models.isFetching}
                          >
                            {t('settings.jev.modelsRetry', 'Retry loading models')}
                          </Button>
                        </AlertDescription>
                      </Alert>
                    )}
                    <FieldDescription>
                      {t(
                        'settings.jev.modelHelp',
                        'Besides specific versions, select jev-latest to automatically use the latest version.'
                      )}
                    </FieldDescription>
                  </Field>
                );
              }}
            </form.Field>
          </FieldGroup>
        </CardContent>
      </Card>
      <form.Subscribe selector={(state) => state.errors}>
        {(errors) =>
          errors.length > 0 && (
            <Alert variant="destructive">
              <AlertDescription>{errors.map(String).join(' ')}</AlertDescription>
            </Alert>
          )
        }
      </form.Subscribe>
      {mutation.error && (
        <Alert variant="destructive">
          <AlertDescription>{mutation.error.message}</AlertDescription>
        </Alert>
      )}
      {probe.error && (
        <Alert variant="destructive">
          <AlertDescription>{probe.error.message}</AlertDescription>
        </Alert>
      )}
      {probe.data && (
        <p role="status" className="text-sm text-success">
          {t('settings.jev.probeSuccess', 'Connected to {{model}} ({{ms}} ms).', {
            model: probe.data.model,
            ms: probe.data.latencyMs,
          })}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={!settings.hasApiKey || mutation.isPending || probe.isPending}
          onClick={() => probe.mutate()}
        >
          {probe.isPending
            ? t('settings.jev.testing', 'Testing…')
            : t('settings.jev.test', 'Test connection')}
        </Button>
        <Button type="submit" disabled={mutation.isPending || probe.isPending}>
          {mutation.isPending ? t('settings.jev.saving', 'Saving…') : t('settings.jev.save', 'Save settings')}
        </Button>
      </div>
    </form>
  );
}

/**
 * Edit the existing Agent environment independently of policy, preserving unsaved model drafts.
 * Never hydrate the password input with a saved credential.
 */
function JevCredentialForm({ settings }: { settings: JevSettingsSnapshot }) {
  const { t } = useI18n();
  const client = useQueryClient();
  const [pending, setPending] = useSafeState(false);
  const [error, setError] = useSafeState<string>();
  const submitting = useRef(false);
  /**
   * Keep credentials out of Query mutation variables and cached errors.
   */
  async function saveKey(apiKey: string | null): Promise<void> {
    if (submitting.current) {
      return;
    }
    submitting.current = true;
    setPending(true);
    setError(undefined);
    try {
      const next = await saveJevCredential({ revision: settings.environmentRevision, apiKey });
      form.reset();
      client.setQueryData(jevSettingsQuery().queryKey, next);
      void client.invalidateQueries({ queryKey: ['environment-settings', 'agent'] });
      toast.add({ title: t('settings.jev.keySaved', 'Agent environment updated'), type: 'success' });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t('settings.jev.keyFailed', 'Could not save the API key.')
      );
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  const form = useForm({
    defaultValues: { apiKey: '' },
    onSubmit: async ({ value }) => {
      if (!value.apiKey.trim()) {
        return;
      }
      await saveKey(value.apiKey.trim());
    },
  });
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>{t('settings.jev.apiKey', 'API Key')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit().catch(() => undefined);
          }}
        >
          <FieldGroup>
            <form.Field name="apiKey">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="jev-key" className="text-xs text-muted-foreground">
                    {t('settings.jev.apiKey', 'API Key')}
                  </FieldLabel>
                  <Input
                    id="jev-key"
                    name={field.name}
                    type="password"
                    autoComplete="new-password"
                    placeholder={
                      settings.hasApiKey
                        ? t('settings.jev.keyConfiguredPlaceholder', '*************** (configured)')
                        : t('settings.jev.keyPlaceholder', 'Enter an API Key')
                    }
                    maxLength={4096}
                    spellCheck={false}
                    disabled={pending}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                  <FieldDescription>
                    {t(
                      'settings.jev.keyHelp',
                      'Used to connect to Jev. Save the key to test the connection.'
                    )}
                  </FieldDescription>
                </Field>
              )}
            </form.Field>
            {settings.apiKeyOverridden && (
              <Alert>
                <AlertDescription>
                  {t('settings.jev.keyOverridden', 'The launch environment overrides this key.')}
                </AlertDescription>
              </Alert>
            )}
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <form.Subscribe selector={(state) => state.values.apiKey}>
                {(apiKey) => (
                  <Button type="submit" disabled={pending || !apiKey.trim()}>
                    {pending
                      ? t('settings.jev.saving', 'Saving…')
                      : t('settings.jev.saveKey', 'Save API key')}
                  </Button>
                )}
              </form.Subscribe>
              <Button
                type="button"
                variant="destructive"
                disabled={pending || !settings.hasStoredApiKey}
                onClick={() => void saveKey(null)}
              >
                {t('settings.jev.removeKey', 'Remove key')}
              </Button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
