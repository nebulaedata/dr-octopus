/**
 * @author Codex
 * @description Configures local runtime endpoints and saves a model verified by onboarding discovery.
 */
import { useForm } from '@tanstack/react-form';
import { DetectLocalProviderBodySchema } from '@octopus/shared/protocol';
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
import { useLocalProviderMutations } from '@/queries/local-provider-queries';
import { useI18n } from '@/i18n/use-i18n';
import type { LocalProviderConfigurationDto } from '@octopus/shared/protocol';

/**
 * Keeps discovery tied to the current address and prevents stale models from being submitted.
 */
export function LocalProviderForm({
  providerKey,
  configuration,
}: {
  providerKey: string;
  configuration: LocalProviderConfigurationDto;
}) {
  const { t } = useI18n();
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
  const { detect, configure } = useLocalProviderMutations(providerKey);
  const busy = detect.isPending || configure.isPending;
  const form = useForm({
    defaultValues: { baseUrl: configuration.baseUrl, modelId: configuration.modelId ?? '' },
    onSubmit: async ({ value }) => {
      if (!detect.data?.models.some((model) => model.id === value.modelId)) {
        return;
      }
      try {
        await configure.mutateAsync(value);
      } catch {
        /* Show the mutation error below. */
      }
    },
  });
  /**
   * Replaces any old discovery result and clears a model that the endpoint no longer exposes.
   */
  async function discover() {
    const baseUrl = form.getFieldValue('baseUrl');
    if (!DetectLocalProviderBodySchema.safeParse({ baseUrl }).success) {
      return;
    }
    detect.reset();
    configure.reset();
    form.setFieldValue('modelId', '');
    try {
      const result = await detect.mutateAsync(baseUrl);
      if (result.models[0]) {
        form.setFieldValue(
          'modelId',
          result.models.some((model) => model.id === configuration.modelId)
            ? configuration.modelId!
            : result.models[0].id
        );
      }
    } catch {
      /* The error remains available for retry without losing the endpoint. */
    }
  }
  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold">{t('settings.providers.local.title', 'Local model configuration')}</h3>
      <Alert>
        <AlertDescription>
          {runtimeHelp[configuration.runtime]}{' '}
          {t(
            'settings.providers.local.helpSuffix',
            'The local address refers to the machine running Dr.Octopus Server. Currently only local services without API Key are supported.'
          )}
        </AlertDescription>
      </Alert>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <FieldGroup>
          <form.Field name="baseUrl" validators={{ onChange: DetectLocalProviderBodySchema.shape.baseUrl }}>
            {(field) => (
              <Field data-invalid={field.state.meta.errors.length > 0}>
                <FieldLabel htmlFor="local-provider-endpoint">
                  {t('settings.providers.local.endpointLabel', 'Endpoint')}
                </FieldLabel>
                <Input
                  id="local-provider-endpoint"
                  value={field.state.value}
                  disabled={busy}
                  aria-invalid={field.state.meta.errors.length > 0}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                    detect.reset();
                    configure.reset();
                    form.setFieldValue('modelId', '');
                  }}
                />
                <FieldDescription>
                  {configuration.runtime === 'ollama'
                    ? t(
                        'settings.providers.local.endpointHelpOllama',
                        'Models are discovered via /api/tags; inference uses /v1.'
                      )
                    : t(
                        'settings.providers.local.endpointHelpOpenAI',
                        'Loaded models are discovered via the OpenAI-compatible /v1/models.'
                      )}
                </FieldDescription>
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>
          <form.Subscribe selector={(state) => state.values.baseUrl}>
            {(baseUrl) => (
              <Button
                type="button"
                variant="outline"
                className="self-start"
                disabled={busy || !DetectLocalProviderBodySchema.safeParse({ baseUrl }).success}
                onClick={() => void discover()}
              >
                {detect.isPending
                  ? t('settings.providers.local.detecting', 'Detecting…')
                  : t('settings.providers.local.detect', 'Detect models')}
              </Button>
            )}
          </form.Subscribe>
          {detect.data?.reachable && detect.data.models.length > 0 && (
            <form.Field name="modelId">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="local-provider-model">
                    {t('settings.providers.local.modelLabel', 'Model')}
                  </FieldLabel>
                  <Select
                    value={field.state.value}
                    disabled={busy}
                    items={detect.data!.models.map((model) => ({
                      value: model.id,
                      label: model.name ?? model.id,
                    }))}
                    onValueChange={(value) => {
                      configure.reset();
                      if (value) {
                        field.handleChange(value);
                      }
                    }}
                  >
                    <SelectTrigger id="local-provider-model" className="w-full" onBlur={field.handleBlur}>
                      <SelectValue placeholder={t('settings.providers.local.modelPlaceholder', 'Select a model')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {detect.data!.models.map((model) => (
                          <SelectItem key={model.id} value={model.id}>
                            {model.name ?? model.id}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </form.Field>
          )}
        </FieldGroup>
        {detect.data && (!detect.data.reachable || detect.data.models.length === 0) && (
          <Alert>
            <AlertDescription>
              {detect.data.reachable
                ? t(
                    'settings.providers.local.noModels',
                    'Connected, but no models available. Download or load a model, then detect again.'
                  )
                : t(
                    'settings.providers.local.unreachable',
                    'Cannot connect to the service. Check that it is started and the address is correct, then detect again.'
                  )}
            </AlertDescription>
          </Alert>
        )}
        {(detect.error || configure.error) && (
          <Alert variant="destructive">
            <AlertDescription>{(detect.error || configure.error)?.message}</AlertDescription>
          </Alert>
        )}
        {configure.isSuccess && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('settings.providers.local.saved', 'Configuration saved.')}
          </p>
        )}
        <form.Subscribe selector={(state) => state.values.modelId}>
          {(modelId) => (
            <Button
              type="submit"
              className="self-start"
              disabled={
                busy || !detect.data?.reachable || !detect.data.models.some((model) => model.id === modelId)
              }
            >
              {configure.isPending
                ? t('settings.providers.local.saving', 'Saving…')
                : t('settings.providers.local.save', 'Save configuration')}
            </Button>
          )}
        </form.Subscribe>
        <p className="text-xs text-muted-foreground">
          {t(
            'settings.providers.local.footerHint',
            'After saving, select this model in the default model settings; new sessions use the latest configuration.'
          )}
        </p>
      </form>
    </section>
  );
}
