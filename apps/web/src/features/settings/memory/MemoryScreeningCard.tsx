/**
 * @author Codex
 * @description Configures the memory-owned optional Jev screening step while linking to shared credentials.
 */
import { useForm } from '@tanstack/react-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@octopus/ui/components/card';
import { Field, FieldGroup, FieldLabel, FieldDescription } from '@octopus/ui/components/field';
import { Button, buttonVariants } from '@octopus/ui/components/button';
import { Input } from '@octopus/ui/components/input';
import { Switch } from '@octopus/ui/components/switch';
import { Alert, AlertDescription } from '@octopus/ui/components/alert';
import { toast } from '@octopus/ui/components/toast';
import { memoryScreeningUpdateSchema } from '@octopus/shared/protocol/memory';
import { memoryScreeningQuery } from '@/queries/memory-queries';
import { jevSettingsQuery } from '@/queries/jev-queries';
import { saveMemoryScreening } from '@/api/memory';
import { useI18n } from '@/i18n/use-i18n';
import { SettingsSectionLink } from '../layout/SettingsSectionLink';
import { ArrowRightIcon } from 'lucide-react';
import type { MemoryScreeningSnapshot } from '@octopus/shared/protocol/memory';

/**
 * Own screening configuration here; connection setup remains in the dedicated Jev page.
 */
export function MemoryScreeningCard() {
  const { t } = useI18n();
  const query = useQuery(memoryScreeningQuery());
  const jev = useQuery(jevSettingsQuery());
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('memory.settings.screening.title', 'Automatic memory screening')}</CardTitle>
        <CardDescription>
          {t(
            'memory.settings.screening.description',
            'Disabled by default. In auto mode, eligible user text is sent to TypeSafe to skip unnecessary curation. Explicit save requests bypass screening.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {query.isPending && (
            <p role="status">{t('memory.settings.screening.loading', 'Loading screening settings…')}</p>
          )}
          {(query.error || jev.error) && (
            <Alert variant="destructive">
              <AlertDescription>{query.error?.message ?? jev.error?.message}</AlertDescription>
            </Alert>
          )}
          {!jev.isPending && !jev.data?.hasApiKey && (
            <FieldDescription>
              {t('memory.settings.screening.keyRequired', 'Configure a Jev API key before using screening.')}
            </FieldDescription>
          )}
          <SettingsSectionLink
            path="/settings/jev"
            className={buttonVariants({ size: 'sm', variant: 'link', className: 'w-fit px-0!' })}
          >
            {t('memory.settings.screening.connection', 'Configure Jev model and API key')}
            <ArrowRightIcon />
          </SettingsSectionLink>
          {query.data && (
            <ScreeningForm
              key={query.data.revision}
              settings={query.data}
              hasApiKey={jev.data?.hasApiKey ?? false}
            />
          )}
        </FieldGroup>
      </CardContent>
    </Card>
  );
}

/**
 * Save one revision-checked memory policy without replacing shared connection configuration.
 */
function ScreeningForm({ settings, hasApiKey }: { settings: MemoryScreeningSnapshot; hasApiKey: boolean }) {
  const { t } = useI18n();
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: saveMemoryScreening,
    onSuccess: (next) => {
      client.setQueryData(memoryScreeningQuery().queryKey, next);
      toast.add({
        title: t('memory.settings.screening.saved', 'Memory screening settings saved'),
        type: 'success',
      });
    },
  });
  const form = useForm({
    defaultValues: settings,
    validators: {
      onSubmit: ({ value }) => {
        if (!memoryScreeningUpdateSchema.safeParse(value).success) {
          return t(
            'memory.settings.screening.invalid',
            'Use a timeout of 250–5000 ms and a threshold of 0.95–1.'
          );
        }
        if (value.enabled && !hasApiKey) {
          return t(
            'memory.settings.screening.keyRequired',
            'Configure a Jev API key before using screening.'
          );
        }
        return undefined;
      },
    },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync(value);
    },
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit().catch(() => undefined);
      }}
    >
      <FieldGroup>
        <form.Field name="enabled">
          {(field) => (
            <Field orientation="horizontal">
              <FieldLabel htmlFor="memory-screening-enabled">
                {t('memory.settings.screening.enabled', 'Use Jev for automatic memory')}
              </FieldLabel>
              <Switch
                id="memory-screening-enabled"
                name={field.name}
                checked={field.state.value}
                onCheckedChange={field.handleChange}
              />
            </Field>
          )}
        </form.Field>
        <form.Field name="timeoutMs">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="memory-screening-timeout">
                {t('memory.settings.screening.timeout', 'Screening timeout (ms)')}
              </FieldLabel>
              <Input
                id="memory-screening-timeout"
                name={field.name}
                type="number"
                min={250}
                max={5000}
                step={50}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(Number(event.target.value))}
              />
            </Field>
          )}
        </form.Field>
        <form.Field name="skipThreshold">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="memory-screening-threshold">
                {t('memory.settings.screening.threshold', 'Minimum skip probability')}
              </FieldLabel>
              <Input
                id="memory-screening-threshold"
                name={field.name}
                type="number"
                min={0.95}
                max={1}
                step={0.01}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(Number(event.target.value))}
              />
              <FieldDescription>
                {t(
                  'memory.settings.screening.thresholdHelp',
                  'Only high-probability skip decisions suppress curation. Uncertain results or failures continue normal curation; this threshold does not guarantee against missed facts.'
                )}
              </FieldDescription>
            </Field>
          )}
        </form.Field>
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
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending
            ? t('memory.settings.screening.saving', 'Saving…')
            : t('memory.settings.screening.save', 'Save screening settings')}
        </Button>
      </FieldGroup>
    </form>
  );
}
