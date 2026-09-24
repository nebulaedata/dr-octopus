/**
 * @author Codex
 * @description Independent validated model form with optional credentials for local inference services.
 */
import { useForm } from '@tanstack/react-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@octopus/ui/components/card';
import { Field, FieldLabel, FieldError } from '@octopus/ui/components/field';
import { Input } from '@octopus/ui/components/input';
import { Button } from '@octopus/ui/components/button';
import { Switch } from '@octopus/ui/components/switch';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@octopus/ui/components/select';
import { Alert, AlertDescription } from '@octopus/ui/components/alert';
import { probeKnowledgeModel, saveKnowledgeModel } from '@/api/knowledge';
import { useI18n } from '@/i18n/use-i18n';
import { UnplugIcon } from 'lucide-react';
import type { KnowledgeModels } from '@octopus/shared/protocol/knowledge';

/**
 * Keep model credentials optional and avoid coupling answer-model selection to retrieval configuration.
 */
export function KnowledgeModelCard({
  kind,
  models,
}: {
  kind: 'embedding' | 'ocr' | 'reranker';
  models: KnowledgeModels;
}) {
  const { t } = useI18n();
  const descriptions = {
    embedding: t(
      'settings.knowledge.model.embeddingDescription',
      'Converts documents into searchable vectors. Existing collections must be rebuilt after changing the model.'
    ),
    ocr: t(
      'settings.knowledge.model.ocrDescription',
      'Recognizes text on scanned PDF pages. Plain text is extracted directly first.'
    ),
    reranker: t(
      'settings.knowledge.model.rerankerDescription',
      'Reorders retrieval results. Basic retrieval results are kept when the service is unavailable.'
    ),
  };
  const current = models[kind];
  const queryClient = useQueryClient();
  const probe = useMutation({ mutationFn: probeKnowledgeModel });
  const mutation = useMutation({
    mutationFn: (config: Parameters<typeof saveKnowledgeModel>[1]) =>
      saveKnowledgeModel(models.revision, config),
    onSuccess: (next) => {
      queryClient.setQueryData(['knowledge', 'models'], next);
    },
  });
  const form = useForm({
    defaultValues: {
      endpoint: current?.endpoint ?? '',
      model: current?.model ?? '',
      apiKey: '',
      dimensions: kind === 'embedding' ? String(models.embedding?.dimensions ?? 1024) : '1024',
      enabled: models.reranker?.enabled ?? true,
      mode: models.ocr?.mode ?? 'auto',
    },
    onSubmit: async ({ value }) => {
      const connection = {
        endpoint: value.endpoint.trim(),
        model: value.model.trim(),
        timeoutMs: kind === 'ocr' ? 60_000 : 30_000,
        ...(value.apiKey ? { apiKey: value.apiKey } : {}),
      };
      /**
       * Selects kindembedding2 in the existing condition order.
       */
      function createConnectionUpdate() {
        if (kind === 'embedding') {
          return { ...connection, kind, dimensions: Number(value.dimensions), batchSize: 16 };
        } else if (kind === 'ocr') {
          return { ...connection, kind, mode: value.mode, maxOutputTokens: 4096 };
        } else {
          return {
            ...connection,
            kind,
            enabled: value.enabled,
            maxCandidates: 40,
            allowRemoteEvidence: false,
          };
        }
      }
      await mutation.mutateAsync(createConnectionUpdate());
      form.setFieldValue('apiKey', '');
    },
  });
  /**
   * Selects card title content in the existing condition order.
   */
  function renderCardTitleContent() {
    if (kind === 'ocr') {
      return t('settings.knowledge.model.ocrTitle', 'OCR · Scan recognition');
    } else if (kind === 'embedding') {
      return t('settings.knowledge.model.embeddingTitle', 'Embedding · Semantic retrieval');
    } else {
      return t('settings.knowledge.model.rerankerTitle', 'Reranker · Result ranking');
    }
  }
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle className="text-base">{renderCardTitleContent()}</CardTitle>
        <CardDescription>{descriptions[kind]}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit().catch(() => undefined);
          }}
        >
          <form.Field
            name="endpoint"
            validators={{
              onSubmit: ({ value }) =>
                /^https?:\/\/\S+$/u.test(value)
                  ? undefined
                  : t('settings.knowledge.model.endpointInvalid', 'Enter an HTTP or HTTPS address'),
            }}
          >
            {(field) => (
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor={`${kind}-endpoint`}>
                  {t('settings.knowledge.model.endpointLabel', 'Endpoint')}
                </FieldLabel>
                <Input
                  id={`${kind}-endpoint`}
                  placeholder="http://localhost:8000/v1"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
              </Field>
            )}
          </form.Field>
          <form.Field
            name="model"
            validators={{
              onSubmit: ({ value }) =>
                value.trim() ? undefined : t('settings.knowledge.model.modelRequired', 'Enter a model name'),
            }}
          >
            {(field) => {
              /**
               * Selects placeholder in the existing condition order.
               */
              function selectPlaceholder() {
                if (kind === 'embedding') {
                  return 'bge-m3' as const;
                } else if (kind === 'ocr') {
                  return 'PaddleOCR-VL-1.6-0.9B' as const;
                } else {
                  return 'bge-reranker-v2-m3' as const;
                }
              }
              return (
                <Field>
                  <FieldLabel htmlFor={`${kind}-model`}>
                    {t('settings.knowledge.model.modelLabel', 'Model name')}
                  </FieldLabel>
                  <Input
                    id={`${kind}-model`}
                    value={field.state.value}
                    placeholder={selectPlaceholder()}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                  <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
                </Field>
              );
            }}
          </form.Field>
          <form.Field name="apiKey">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={`${kind}-key`}>
                  {t('settings.knowledge.model.apiKeyLabel', 'API Key')}{' '}
                  <span className="font-normal text-muted-foreground">
                    {t('settings.knowledge.model.optional', 'Optional')}
                  </span>
                </FieldLabel>
                <Input
                  id={`${kind}-key`}
                  type="password"
                  autoComplete="new-password"
                  placeholder={
                    current?.secretRef
                      ? t(
                          'settings.knowledge.model.apiKeySavedPlaceholder',
                          'Saved; leave empty to keep unchanged'
                        )
                      : t('settings.knowledge.model.apiKeyEmptyPlaceholder', 'Leave empty for local services')
                  }
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          {kind === 'embedding' ? (
            <form.Field
              name="dimensions"
              validators={{
                onSubmit: ({ value }) =>
                  Number.isInteger(Number(value)) && Number(value) > 0 && Number(value) <= 8192
                    ? undefined
                    : t(
                        'settings.knowledge.model.dimensionsInvalid',
                        'Dimensions must be between 1 and 8192'
                      ),
              }}
            >
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="embedding-dimensions">
                    {t('settings.knowledge.model.dimensionsLabel', 'Vector dimensions')}
                  </FieldLabel>
                  <Input
                    id="embedding-dimensions"
                    type="number"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                  <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
                </Field>
              )}
            </form.Field>
          ) : null}
          {kind === 'ocr' ? (
            <form.Field name="mode">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="ocr-mode">
                    {t('settings.knowledge.model.modeLabel', 'Recognition mode')}
                  </FieldLabel>
                  <Select
                    value={field.state.value}
                    onValueChange={(value) => {
                      if (value) {
                        field.handleChange(value);
                      }
                    }}
                  >
                    <SelectTrigger id="ocr-mode" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">
                        {t('settings.knowledge.model.modeAuto', 'Auto-detect scanned pages')}
                      </SelectItem>
                      <SelectItem value="force">
                        {t('settings.knowledge.model.modeForce', 'Use OCR on all pages')}
                      </SelectItem>
                      <SelectItem value="off">
                        {t('settings.knowledge.model.modeOff', 'Disable OCR')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </form.Field>
          ) : null}
          {kind === 'reranker' ? (
            <form.Field name="enabled">
              {(field) => (
                <Field className="flex-row items-center">
                  <Switch
                    id="reranker-enabled"
                    checked={field.state.value}
                    onCheckedChange={field.handleChange}
                  />
                  <FieldLabel htmlFor="reranker-enabled">
                    {t('settings.knowledge.model.enabledLabel', 'Enable result reranking')}
                  </FieldLabel>
                </Field>
              )}
            </form.Field>
          ) : null}
          {mutation.error || probe.error ? (
            <Alert variant="destructive" className="sm:col-span-2">
              <AlertDescription>{(mutation.error ?? probe.error)?.message}</AlertDescription>
            </Alert>
          ) : null}
          {probe.data ? (
            <p role="status" className="text-xs text-success sm:col-span-2">
              {t('settings.knowledge.model.probeResult', '{{summary}} · {{elapsed}} ms', {
                summary: probe.data.summary,
                elapsed: probe.data.elapsedMs,
              })}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-3 sm:col-span-2">
            <span role="status" className="text-xs text-muted-foreground">
              {mutation.isSuccess ? t('settings.knowledge.model.saved', 'Configuration saved') : ''}
            </span>
            <Button
              type="button"
              variant="outline"
              disabled={probe.isPending || mutation.isPending}
              onClick={() => {
                const value = form.state.values;
                const connection = {
                  endpoint: value.endpoint.trim(),
                  model: value.model.trim(),
                  apiKey: value.apiKey,
                  timeoutMs: kind === 'ocr' ? 60_000 : 30_000,
                };
                /**
                 * Selects kindembedding in the existing condition order.
                 */
                function createModelUpdate() {
                  if (kind === 'embedding') {
                    return { ...connection, kind, dimensions: Number(value.dimensions), batchSize: 16 };
                  } else if (kind === 'ocr') {
                    return { ...connection, kind, mode: value.mode, maxOutputTokens: 4096 };
                  } else {
                    return {
                      ...connection,
                      kind,
                      enabled: value.enabled,
                      maxCandidates: 40,
                      allowRemoteEvidence: false,
                    };
                  }
                }
                probe.mutate(createModelUpdate());
              }}
            >
              <UnplugIcon />
              {probe.isPending
                ? t('settings.knowledge.model.testing', 'Testing…')
                : t('settings.knowledge.model.test', 'Test model')}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending
                ? t('settings.knowledge.model.saving', 'Saving…')
                : t('settings.knowledge.model.save', 'Save configuration')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
