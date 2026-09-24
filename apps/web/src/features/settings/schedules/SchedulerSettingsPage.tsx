/**
 * @author Codex
 * @description Configures cron defaults and global Scheduler execution capacity.
 */
import { SettingContainer } from '../Layout/SettingContainer';
import { useEffect } from 'react';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, AlertDescription, AlertTitle } from '@octopus/ui/components/alert';
import { Button } from '@octopus/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@octopus/ui/components/card';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@octopus/ui/components/field';
import { Input } from '@octopus/ui/components/input';
import { Spinner } from '@octopus/ui/components/spinner';
import { toast } from '@octopus/ui/components/toast';
import { getSchedulerSettings, updateSchedulerSettings } from '@/api/scheduled-tasks';
import { useI18n } from '@/i18n/use-i18n';
import { SchedulerServicePanel } from './SchedulerServicePanel';

/**
 * Validate one IANA timezone with the browser's standards implementation.
 */
function validTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

/**
 * Presents Scheduler configuration inside the global Settings frame.
 */
export function SchedulerSettingsPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ['scheduler-settings'],
    queryFn: ({ signal }) => getSchedulerSettings(signal),
  });
  const update = useMutation({
    mutationFn: updateSchedulerSettings,
    onSuccess: (value) => {
      queryClient.setQueryData(['scheduler-settings'], value);
      toast.add({
        title: t('settings.scheduler.saved', 'Scheduler settings saved'),
        description: t(
          'settings.scheduler.savedDescription',
          'New cron tasks will use the default timezone; the concurrency limit takes effect immediately.'
        ),
        type: 'success',
      });
    },
  });
  const form = useForm({
    defaultValues: { timezone: '', maxConcurrentRuns: '3' },
    onSubmit: async ({ value }) => {
      if (!settings.data) {
        return;
      }
      await update.mutateAsync({
        timezone: value.timezone.trim(),
        maxConcurrentRuns: Number(value.maxConcurrentRuns),
        revision: settings.data.revision,
      });
    },
  });

  useEffect(() => {
    if (settings.data) {
      form.setFieldValue('timezone', settings.data.timezone);
      form.setFieldValue('maxConcurrentRuns', String(settings.data.maxConcurrentRuns));
    }
  }, [form, settings.data]);

  return (
    <SettingContainer>
      <SchedulerServicePanel />
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t('settings.scheduler.cronTitle', 'Cron configuration')}</CardTitle>
          <CardDescription className="text-xs">
            {t(
              'settings.scheduler.cronDescription',
              "Settings are stored in the Scheduler's cron.json; task and run data stay in SQLite."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void form.handleSubmit();
            }}
          >
            <FieldGroup>
              <form.Field
                name="timezone"
                validators={{
                  onSubmit: ({ value }) =>
                    validTimezone(value.trim())
                      ? undefined
                      : t('settings.scheduler.timezoneInvalid', 'Enter a valid IANA timezone.'),
                }}
              >
                {(field) => (
                  <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
                    <FieldLabel htmlFor="scheduler-timezone">
                      {t('settings.scheduler.timezoneLabel', 'Default cron timezone')}
                    </FieldLabel>
                    <Input
                      id="scheduler-timezone"
                      placeholder="Asia/Shanghai"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                    />
                    <FieldDescription>
                      {t(
                        'settings.scheduler.timezoneDescription',
                        'Only used as the default for new cron tasks; existing tasks are not modified.'
                      )}
                    </FieldDescription>
                    <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
                  </Field>
                )}
              </form.Field>
              <form.Field
                name="maxConcurrentRuns"
                validators={{
                  onSubmit: ({ value }) => {
                    const number = Number(value);
                    return Number.isSafeInteger(number) && number >= 1 && number <= 32
                      ? undefined
                      : t('settings.scheduler.concurrencyInvalid', 'Concurrency must be an integer between 1 and 32.');
                  },
                }}
              >
                {(field) => (
                  <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
                    <FieldLabel htmlFor="scheduler-concurrency">
                      {t('settings.scheduler.concurrencyLabel', 'Concurrent task limit')}
                    </FieldLabel>
                    <Input
                      id="scheduler-concurrency"
                      type="number"
                      min={1}
                      max={32}
                      step={1}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                    />
                    <FieldDescription>
                      {t(
                        'settings.scheduler.concurrencyDescription',
                        'Lowering the limit does not interrupt running tasks; it only restricts new tasks from starting.'
                      )}
                    </FieldDescription>
                    <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
                  </Field>
                )}
              </form.Field>
            </FieldGroup>
            {(settings.error ?? update.error) instanceof Error ? (
              <Alert variant="destructive">
                <AlertTitle>{t('settings.scheduler.saveFailed', 'Failed to save settings')}</AlertTitle>
                <AlertDescription>{(update.error ?? settings.error)?.message}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex justify-end">
              <Button type="submit" disabled={settings.isPending || update.isPending || !settings.data}>
                {update.isPending ? <Spinner data-icon="inline-start" /> : null}
                {t('settings.scheduler.save', 'Save settings')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </SettingContainer>
  );
}
