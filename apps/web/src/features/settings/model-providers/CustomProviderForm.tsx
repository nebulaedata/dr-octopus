/**
 * @author Codex
 * @description Synchronizes every model exposed by a custom local or remote service.
 */
import { useEffect, useRef } from 'react';
import { RefreshCwIcon } from 'lucide-react';
import { useForm } from '@tanstack/react-form';
import { ConfigureCustomProviderBodySchema } from '@octopus/shared/protocol';
import { Alert, AlertDescription } from '@octopus/ui/components/alert';
import { Button } from '@octopus/ui/components/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@octopus/ui/components/field';
import { Input } from '@octopus/ui/components/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@octopus/ui/components/select';
import { useCustomProviderMutations } from '@/queries/custom-provider-queries';
import { useI18n } from '@/i18n/use-i18n';
import { ProviderModelList } from './ProviderModelList';
import type {
  CustomProviderConfigurationDto,
  ModelProviderDetailDto,
  ModelServiceApi,
} from '@octopus/shared/protocol';

/**
 * Keeps model synchronization tied to the current address, protocol and credential.
 */
export function CustomProviderForm({
  provider,
  configuration,
  keyConfigured,
}: {
  provider: ModelProviderDetailDto;
  configuration: CustomProviderConfigurationDto;
  keyConfigured: boolean;
}) {
  const { t } = useI18n();
  const relay = configuration.runtime === 'mr-token';
  const local = ['ollama', 'vllm', 'lmstudio'].includes(configuration.runtime);
  const runtimeHelp: Record<string, string> = {
    ollama: t(
      'settings.providers.local.runtimeHelp.ollama',
      'Start Ollama (ollama serve) and download models with ollama pull. Default address: http://127.0.0.1:11434.'
    ),
    vllm: t(
      'settings.providers.local.runtimeHelp.vllm',
      "Start vLLM's OpenAI-compatible server (vllm serve <model>). Default address: http://127.0.0.1:8000/v1."
    ),
    lmstudio: t(
      'settings.providers.local.runtimeHelp.lmstudio',
      'Load a model in LM Studio and start the Local Server. Default address: http://127.0.0.1:1234/v1.'
    ),
  };
  let endpointHelp = t(
    'settings.providers.local.endpointHelpRemote',
    'Enter the provider’s OpenAI-compatible base URL and any required path prefix.'
  );
  if (relay) {
    endpointHelp = t(
      'settings.providers.local.endpointHelpRelay',
      'Enter the relay API base URL. Each model uses its original model’s protocol.'
    );
  }
  if (local) {
    endpointHelp = t(
      'settings.providers.local.endpointHelpOpenAI',
      'Loaded models are discovered via the OpenAI-compatible /v1/models.'
    );
  }
  if (configuration.runtime === 'ollama') {
    endpointHelp = t(
      'settings.providers.local.endpointHelpOllama',
      'Models are discovered via /api/tags; inference uses /v1.'
    );
  }
  const completionsLabel = t('settings.providers.local.chatCompletions', 'Chat Completions');
  const responsesLabel = t('settings.providers.local.responses', 'Responses');
  const emptyModelsMessage = local
    ? t(
        'settings.providers.local.noModels',
        'Connected, but no models available. Download or load a model, then detect again.'
      )
    : t(
        'settings.providers.local.noRemoteModels',
        'Connected, but this provider returned no models. Check the API Key and endpoint, then try again.'
      );
  const { configure } = useCustomProviderMutations(provider.providerKey);
  const busy = configure.isPending;
  const synchronizing = useRef(false);
  const initialDiscovery = useRef(false);
  const form = useForm({
    defaultValues: {
      baseUrl: configuration.baseUrl,
      api: relay ? undefined : ((configuration.api ?? 'openai-completions') as ModelServiceApi),
      apiKey: '',
    },
    onSubmit: async ({ value }) => {
      if (
        synchronizing.current ||
        !ConfigureCustomProviderBodySchema.safeParse(value).success ||
        (!local && !value.apiKey.trim() && !keyConfigured)
      ) {
        return;
      }
      synchronizing.current = true;
      configure.reset();
      try {
        await configure.mutateAsync(relay ? { baseUrl: value.baseUrl, apiKey: value.apiKey } : value);
        form.setFieldValue('apiKey', '');
      } catch {
        /* Show the mutation error below. */
      } finally {
        synchronizing.current = false;
      }
    },
  });
  useEffect(() => {
    if (!initialDiscovery.current) {
      initialDiscovery.current = true;
      void form.handleSubmit();
    }
  });
  return (
    <>
      <section className="flex flex-col gap-4">
        <h3 className="text-sm font-semibold">
          {t('settings.providers.local.title', 'Model service configuration')}
        </h3>
        {local && (
          <Alert>
            <AlertDescription>
              {runtimeHelp[configuration.runtime]}{' '}
              {t(
                'settings.providers.local.helpSuffix',
                'The local address refers to the machine running Dr.Octopus Server.'
              )}
            </AlertDescription>
          </Alert>
        )}
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <FieldGroup>
            <form.Field
              name="baseUrl"
              validators={{ onChange: ConfigureCustomProviderBodySchema.shape.baseUrl }}
            >
              {(field) => (
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  <FieldLabel htmlFor="custom-provider-endpoint">
                    {t('settings.providers.local.endpointLabel', 'Endpoint')}
                  </FieldLabel>
                  <Input
                    id="custom-provider-endpoint"
                    value={field.state.value}
                    disabled={busy}
                    aria-invalid={field.state.meta.errors.length > 0}
                    onBlur={() => {
                      field.handleBlur();
                      void form.handleSubmit();
                    }}
                    onChange={(event) => {
                      field.handleChange(event.target.value);
                      configure.reset();
                    }}
                  />
                  <FieldDescription>{endpointHelp}</FieldDescription>
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
            {!local && !relay && (
              <form.Field name="api">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="model-service-api">
                      {t('settings.providers.local.apiLabel', 'API protocol')}
                    </FieldLabel>
                    <Select
                      value={field.state.value}
                      items={[
                        { value: 'openai-completions', label: completionsLabel },
                        { value: 'openai-responses', label: responsesLabel },
                      ]}
                      onValueChange={(value) => {
                        if (value) {
                          field.handleChange(value as ModelServiceApi);
                          configure.reset();
                          queueMicrotask(() => void form.handleSubmit());
                        }
                      }}
                      disabled={busy}
                    >
                      <SelectTrigger id="model-service-api" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="openai-completions">{completionsLabel}</SelectItem>
                          <SelectItem value="openai-responses">{responsesLabel}</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              </form.Field>
            )}
            <form.Field name="apiKey">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="model-service-api-key">
                    {t('settings.providers.local.apiKeyLabel', 'API Key')}
                  </FieldLabel>
                  <Input
                    id="model-service-api-key"
                    name="apiKey"
                    type="password"
                    autoComplete="new-password"
                    placeholder={
                      keyConfigured
                        ? t('settings.providers.local.keyConfigured', '******** (configured)')
                        : ''
                    }
                    value={field.state.value}
                    onBlur={() => {
                      field.handleBlur();
                      void form.handleSubmit();
                    }}
                    onChange={(event) => {
                      field.handleChange(event.target.value);
                      configure.reset();
                    }}
                    disabled={busy}
                    spellCheck={false}
                  />
                  <FieldDescription>
                    {local
                      ? t('settings.providers.local.keyOptional', 'Optional for local services.')
                      : t(
                          'settings.providers.local.keyRequired',
                          'Required when first configuring a remote service. Leave blank later to keep the saved key.'
                        )}
                  </FieldDescription>
                </Field>
              )}
            </form.Field>
          </FieldGroup>
          {configure.data && configure.data.models.length === 0 && (
            <Alert>
              <AlertDescription>{emptyModelsMessage}</AlertDescription>
            </Alert>
          )}
          {configure.error && (
            <Alert variant="destructive">
              <AlertDescription>{configure.error.message}</AlertDescription>
            </Alert>
          )}
        </form>
      </section>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{t('settings.providers.modelsTitle', 'Models')}</h3>
            <p className="text-xs text-muted-foreground" role="status">
              {configure.isSuccess && `${t('settings.providers.local.modelsSynced', 'Model list updated.')} `}
              {t(
                'settings.providers.modelsAvailable',
                '{{available}} of {{total}} models currently available',
                {
                  available: provider.availableModelCount,
                  total: provider.modelCount,
                }
              )}
            </p>
          </div>
          <form.Subscribe selector={(state) => state.values}>
            {({ baseUrl, apiKey, api }) => (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={
                  busy ||
                  !ConfigureCustomProviderBodySchema.safeParse({ baseUrl, apiKey, api }).success ||
                  (!local && !apiKey.trim() && !keyConfigured)
                }
                onClick={() => void form.handleSubmit()}
              >
                <RefreshCwIcon aria-hidden="true" className={busy ? 'motion-safe:animate-spin' : undefined} />
                {busy
                  ? t('settings.providers.local.detecting', 'Getting models…')
                  : t('settings.providers.local.detect', 'Get models')}
              </Button>
            )}
          </form.Subscribe>
        </div>
        <ProviderModelList provider={provider} />
      </section>
    </>
  );
}
