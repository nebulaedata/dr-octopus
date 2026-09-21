/**
 * @author Codex
 * @description Edits explicit schedule intent using TanStack Form and shared domain validation.
 */
import { formatDateTime } from '@/utils/date';
import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { DialogFooter } from '@octopus/ui/components/dialog';
import { ScheduleDialogBody } from './ScheduleDialog';
import { Button } from '@octopus/ui/components/button';
import { Input } from '@octopus/ui/components/input';
import { Textarea } from '@octopus/ui/components/textarea';
import { Field, FieldGroup, FieldLabel, FieldDescription } from '@octopus/ui/components/field';
import { scheduledTaskInputSchema } from '@octopus/shared/protocol/scheduled-tasks';
import { useI18n } from '@/i18n/use-i18n';
import { ScheduleSelect } from './ScheduleSelect';
import type { ScheduledTask, ScheduledTaskInput } from '@octopus/shared/protocol/scheduled-tasks';

/**
 * Represents an instant as a browser-local datetime input without dropping its timezone on submit.
 */
function localDate(value: string): string {
  return formatDateTime(value, 'YYYY-MM-DDTHH:mm');
}

/**
 * Keeps edit defaults stable while catalog invalidation refreshes the list behind the form.
 */
export function ScheduleForm({
  task,
  pending,
  defaultTimezone,
  onSave,
  onClose,
}: {
  task: ScheduledTask;
  pending: boolean;
  defaultTimezone?: string;
  onSave(input: ScheduledTaskInput): Promise<void>;
  onClose(): void;
}) {
  const [error, setError] = useState('');
  const { t } = useI18n();
  const [defaultAt] = useState(() => new Date(Date.now() + 3600_000).toISOString());
  const schedule = task?.schedule;
  const form = useForm({
    defaultValues: {
      name: task?.name ?? '',
      prompt: task?.prompt ?? '',
      type: schedule?.type ?? 'once',
      at: localDate(
        schedule?.type === 'once'
          ? schedule.at
          : schedule?.type === 'interval'
            ? schedule.anchorAt
            : defaultAt
      ),
      expression: schedule?.type === 'cron' ? schedule.expression : '0 9 * * *',
      timezone:
        schedule?.type === 'cron'
          ? schedule.timezone
          : (defaultTimezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone),
      minutes: schedule?.type === 'interval' ? String(schedule.everyMs / 60_000) : '60',
      timeoutMinutes: String((task?.timeoutMs ?? 1_800_000) / 60_000),
      misfirePolicy: task?.misfirePolicy ?? 'coalesce',
      overlapPolicy: task?.overlapPolicy ?? 'queue-one',
    },
    onSubmit: async ({ value }) => {
      setError('');
      try {
        const originalAt =
          schedule?.type === 'once'
            ? schedule.at
            : schedule?.type === 'interval'
              ? schedule.anchorAt
              : undefined;
        const instant =
          value.type === 'cron'
            ? ''
            : originalAt && value.at === localDate(originalAt)
              ? originalAt
              : new Date(value.at).toISOString();
        const nextSchedule =
          value.type === 'cron'
            ? { type: 'cron', expression: value.expression, timezone: value.timezone }
            : value.type === 'interval'
              ? {
                  type: 'interval',
                  everyMs: Number(value.minutes) * 60_000,
                  anchorAt: instant,
                }
              : { type: 'once', at: instant };
        const parsed = scheduledTaskInputSchema.safeParse({
          name: value.name,
          prompt: value.prompt,
          description: task?.description ?? '',
          enabled: task?.enabled ?? true,
          schedule: nextSchedule,
          misfirePolicy: value.misfirePolicy,
          overlapPolicy: value.overlapPolicy,
          timeoutMs: Number(value.timeoutMinutes) * 60_000,
        });
        if (!parsed.success) {
          throw new Error(
            t(
              'schedules.form.validationFailed',
              'Check the name, prompt, time, and interval; the interval is at least 1 minute and the timeout at most 24 hours.'
            )
          );
        }
        await onSave(parsed.data);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : t('schedules.form.saveFailed', 'Save failed. Please try again.'));
      }
    },
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
      className="flex min-h-0 flex-1 flex-col gap-4"
    >
      <ScheduleDialogBody>
        <FieldGroup>
          <form.Field name="name">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="schedule-name">{t('schedules.form.name', 'Task name')}</FieldLabel>
                <Input
                  id="schedule-name"
                  required
                  maxLength={200}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="prompt">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="schedule-prompt">
                  {t('schedules.form.prompt', 'Run prompt')}
                </FieldLabel>
                <Textarea
                  id="schedule-prompt"
                  required
                  rows={4}
                  maxLength={100_000}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="type">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="schedule-type">
                  {t('schedules.form.triggerType', 'Trigger type')}
                </FieldLabel>
                <ScheduleSelect
                  id="schedule-type"
                  value={field.state.value}
                  onChange={(value) => field.handleChange(value as 'once' | 'cron' | 'interval')}
                  items={[
                    { value: 'once', label: t('schedules.form.typeOnce', 'One-time') },
                    { value: 'interval', label: t('schedules.form.typeInterval', 'Fixed interval') },
                    { value: 'cron', label: 'Cron' },
                  ]}
                />
              </Field>
            )}
          </form.Field>
          <form.Subscribe selector={(state) => state.values.type}>
            {(type) =>
              type === 'cron' ? (
                <>
                  <form.Field name="expression">
                    {(field) => (
                      <Field>
                        <FieldLabel htmlFor="schedule-expression">
                          {t('schedules.form.cronExpression', 'Cron (minute hour day month weekday)')}
                        </FieldLabel>
                        <Input
                          id="schedule-expression"
                          required
                          value={field.state.value}
                          onChange={(event) => field.handleChange(event.target.value)}
                        />
                        <FieldDescription>
                          {t(
                            'schedules.form.cronExample',
                            'For example, 0 9 * * * means every day at 09:00.'
                          )}
                        </FieldDescription>
                      </Field>
                    )}
                  </form.Field>
                  <form.Field name="timezone">
                    {(field) => (
                      <Field>
                        <FieldLabel htmlFor="schedule-timezone">
                          {t('schedules.form.timezone', 'IANA timezone')}
                        </FieldLabel>
                        <Input
                          id="schedule-timezone"
                          required
                          placeholder="Asia/Shanghai"
                          value={field.state.value}
                          onChange={(event) => field.handleChange(event.target.value)}
                        />
                      </Field>
                    )}
                  </form.Field>
                </>
              ) : (
                <>
                  <form.Field name="at">
                    {(field) => (
                      <Field>
                        <FieldLabel htmlFor="schedule-at">
                          {type === 'once'
                            ? t('schedules.form.runAt', 'Run at')
                            : t('schedules.form.intervalAnchor', 'Interval anchor')}
                          {' ('}
                          {Intl.DateTimeFormat().resolvedOptions().timeZone})
                        </FieldLabel>
                        <Input
                          id="schedule-at"
                          type="datetime-local"
                          required
                          value={field.state.value}
                          onChange={(event) => field.handleChange(event.target.value)}
                        />
                      </Field>
                    )}
                  </form.Field>
                  {type === 'interval' && (
                    <form.Field name="minutes">
                      {(field) => (
                        <Field>
                          <FieldLabel htmlFor="schedule-minutes">
                            {t('schedules.form.everyMinutes', 'Every how many minutes')}
                          </FieldLabel>
                          <Input
                            id="schedule-minutes"
                            type="number"
                            min={1}
                            required
                            value={field.state.value}
                            onChange={(event) => field.handleChange(event.target.value)}
                          />
                        </Field>
                      )}
                    </form.Field>
                  )}
                </>
              )
            }
          </form.Subscribe>
          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="misfirePolicy">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="schedule-misfire">
                    {t('schedules.form.misfirePolicy', 'Missed run time')}
                  </FieldLabel>
                  <ScheduleSelect
                    id="schedule-misfire"
                    value={field.state.value}
                    onChange={(value) => field.handleChange(value as 'skip' | 'coalesce')}
                    items={[
                      { value: 'coalesce', label: t('schedules.form.misfireCoalesce', 'Coalesce into one catch-up run') },
                      { value: 'skip', label: t('schedules.form.policySkip', 'Skip') },
                    ]}
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="overlapPolicy">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="schedule-overlap">
                    {t('schedules.form.overlapPolicy', 'Session already running')}
                  </FieldLabel>
                  <ScheduleSelect
                    id="schedule-overlap"
                    value={field.state.value}
                    onChange={(value) => field.handleChange(value as 'skip' | 'queue-one')}
                    items={[
                      { value: 'queue-one', label: t('schedules.form.overlapQueueOne', 'Keep one queued run') },
                      { value: 'skip', label: t('schedules.form.policySkip', 'Skip') },
                    ]}
                  />
                </Field>
              )}
            </form.Field>
          </div>
          <form.Field name="timeoutMinutes">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="schedule-timeout">
                  {t('schedules.form.timeoutMinutes', 'Run timeout (minutes)')}
                </FieldLabel>
                <Input
                  id="schedule-timeout"
                  type="number"
                  min={1}
                  max={1440}
                  required
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
        </FieldGroup>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </ScheduleDialogBody>
      <DialogFooter className="shrink-0">
        <Button type="button" variant="outline" onClick={onClose}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending
            ? t('schedules.form.saving', 'Saving…')
            : t('schedules.form.saveTask', 'Save task')}
        </Button>
      </DialogFooter>
    </form>
  );
}
