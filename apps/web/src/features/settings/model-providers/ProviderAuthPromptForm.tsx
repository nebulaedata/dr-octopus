/**
 * @author Codex
 * @description Owns one transient Provider authentication prompt without caching its answer.
 */

import { useForm } from '@tanstack/react-form';
import { TriangleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@octopus/ui/components/alert';
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
import { Spinner } from '@octopus/ui/components/spinner';
import { useAuthPromptSubmission } from '@/queries/provider-auth-queries';
import { useI18n } from '@/i18n/use-i18n';
import type { AuthSessionPromptDto } from '@octopus/shared/protocol';

export interface ProviderAuthPromptFormProps {
  providerKey: string;
  authSessionId: string;
  prompt: AuthSessionPromptDto;
}

/**
 * Owns one prompt answer in TanStack Form and clears it immediately after submission.
 */
export function ProviderAuthPromptForm({ providerKey, authSessionId, prompt }: ProviderAuthPromptFormProps) {
  const { t } = useI18n();
  const submission = useAuthPromptSubmission(providerKey, authSessionId);
  const form = useForm({
    defaultValues: { answer: '' },
    onSubmit: async ({ value }) => {
      try {
        await submission.submit(prompt.id, () => value.answer);
      } finally {
        form.reset();
      }
    },
  });
  const options = prompt.options?.map((option) => ({ value: option.id, label: option.label })) ?? [];
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit().catch(() => undefined);
      }}
    >
      <FieldGroup>
        <form.Field
          name="answer"
          validators={{
            onSubmit: ({ value }) =>
              value.length === 0 ? t('settings.providers.auth.answerRequired', 'Fill in the authentication information.') : undefined,
          }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
              <FieldLabel htmlFor={`auth-prompt-${prompt.id}`}>{prompt.message}</FieldLabel>
              {prompt.type === 'select' ? (
                <Select
                  items={options}
                  value={field.state.value || null}
                  onValueChange={(value) => field.handleChange(value ?? '')}
                >
                  <SelectTrigger
                    id={`auth-prompt-${prompt.id}`}
                    aria-invalid={field.state.meta.errors.length > 0 || undefined}
                    onBlur={field.handleBlur}
                  >
                    <SelectValue placeholder={t('settings.providers.auth.selectPlaceholder', 'Select')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {prompt.options?.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id={`auth-prompt-${prompt.id}`}
                  type={prompt.type === 'secret' ? 'password' : 'text'}
                  autoComplete={prompt.type === 'secret' ? 'new-password' : 'off'}
                  placeholder={prompt.placeholder}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={field.state.meta.errors.length > 0 || undefined}
                  autoFocus
                />
              )}
              <FieldDescription className="text-xs">
                {prompt.type === 'secret'
                  ? t(
                      'settings.providers.auth.secretDescription',
                      'This value is only used for the current request and is cleared from form state right after submission.'
                    )
                  : t(
                      'settings.providers.auth.answerDescription',
                      'Wait for the provider to return the next step after submitting.'
                    )}
              </FieldDescription>
              <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
            </Field>
          )}
        </form.Field>
        {submission.error === undefined ? null : (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>{t('settings.providers.auth.submitFailed', 'Submission failed')}</AlertTitle>
            <AlertDescription>{submission.error.message}</AlertDescription>
          </Alert>
        )}
        <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, answer: state.values.answer })}>
          {({ canSubmit, answer }) => (
            <Button type="submit" disabled={!canSubmit || answer.length === 0 || submission.pending}>
              {submission.pending ? <Spinner data-icon="inline-start" /> : null}
              {t('common.submit', 'Submit')}
            </Button>
          )}
        </form.Subscribe>
      </FieldGroup>
    </form>
  );
}
