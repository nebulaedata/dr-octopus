/**
 * @author Codex
 * @description Edits up to four home quick phrases and their Agent modes in appearance settings.
 */
import { useForm } from '@tanstack/react-form';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { toast } from '@octopus/ui/components/toast';
import { Button } from '@octopus/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@octopus/ui/components/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@octopus/ui/components/field';
import { Input } from '@octopus/ui/components/input';
import { Textarea } from '@octopus/ui/components/textarea';
import { ToggleGroup, ToggleGroupItem } from '@octopus/ui/components/toggle-group';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@octopus/ui/components/select';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@octopus/ui/components/empty';
import { useI18n } from '@/i18n/use-i18n';
import { MAX_SNIPPETS, useSnippets } from '@/stores/snippets';
import { SettingContainer } from '../Layout/SettingContainer';
import type { Snippet } from '@/stores/snippets';

/**
 * Keeps edits local until saved and persists complete, validated phrases as one settings update.
 */
export function SnippetsSettingsPage() {
  const { t } = useI18n();
  const snippets = useSnippets((state) => state.snippets);
  const form = useForm({
    defaultValues: { snippets },
    onSubmit: ({ value }) => {
      useSnippets.getState().save(value.snippets);
      form.reset({ snippets: useSnippets.getState().snippets });
      toast.add({ title: t('settings.snippets.saved', 'Quick phrases saved'), type: 'success' });
    },
  });
  const modes = [
    { value: 'agent', label: t('session.workMode.agent', 'Agent') },
    { value: 'plan', label: t('session.workMode.plan', 'Plan') },
    { value: 'knowledge', label: t('session.knowledgeMode.title', 'Knowledge Q&A') },
  ] satisfies { value: Snippet['workMode']; label: string }[];
  return (
    <SettingContainer>
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.snippets.title', 'Quick phrases')}</CardTitle>
          <CardDescription>
            {t(
              'settings.snippets.description',
              'Save up to 4 phrases on this device. Choose an Agent mode and whether clicking sends the message or fills the composer.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void form.handleSubmit();
            }}
          >
            <form.Field name="snippets" mode="array">
              {(field) => (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {t('settings.snippets.count', '{{count}} / 4 phrases', {
                        count: field.state.value.length,
                      })}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={field.state.value.length >= MAX_SNIPPETS}
                      onClick={() =>
                        field.pushValue({
                          id: crypto.randomUUID(),
                          title: '',
                          message: '',
                          workMode: 'agent',
                          action: 'send',
                        })
                      }
                    >
                      <PlusIcon data-icon="inline-start" />
                      {t('settings.snippets.add', 'Add phrase')}
                    </Button>
                  </div>
                  {field.state.value.length === 0 && (
                    <Empty className="border border-dashed">
                      <EmptyHeader>
                        <EmptyTitle>
                          {t('settings.snippets.empty', 'Your next conversation, one click away')}
                        </EmptyTitle>
                        <EmptyDescription>
                          {t(
                            'settings.snippets.emptyDescription',
                            'Add a frequently used request and choose how your Agent should handle it.'
                          )}
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  )}
                  {field.state.value.map((snippet, index) => (
                    <div key={snippet.id} className="flex flex-col gap-4 rounded-xl border bg-muted/20 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-sm font-medium">
                          {t('settings.snippets.number', 'Phrase {{number}}', { number: index + 1 })}
                        </h3>
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon-sm"
                          aria-label={`Remove phrase ${index + 1}`}
                          title={t('settings.snippets.remove', 'Remove phrase')}
                          onClick={() => field.removeValue(index)}
                        >
                          <Trash2Icon />
                        </Button>
                      </div>
                      <FieldGroup>
                        <form.Field
                          name={`snippets[${index}].title`}
                          validators={{
                            onChange: ({ value }) =>
                              value.trim()
                                ? undefined
                                : t('settings.snippets.titleRequired', 'Enter a card title.'),
                          }}
                        >
                          {(title) => (
                            <Field data-invalid={title.state.meta.isTouched && !title.state.meta.isValid}>
                              <FieldLabel htmlFor={`${snippet.id}-title`}>
                                {t('settings.snippets.cardTitle', 'Card title')}
                              </FieldLabel>
                              <Input
                                id={`${snippet.id}-title`}
                                value={title.state.value}
                                maxLength={60}
                                placeholder={t(
                                  'settings.snippets.titlePlaceholder',
                                  'For example: Plan my day'
                                )}
                                onBlur={title.handleBlur}
                                onChange={(event) => title.handleChange(event.target.value)}
                                aria-invalid={title.state.meta.isTouched && !title.state.meta.isValid}
                              />
                              {title.state.meta.isTouched && (
                                <FieldError>{title.state.meta.errors.join(' ')}</FieldError>
                              )}
                            </Field>
                          )}
                        </form.Field>
                        <form.Field
                          name={`snippets[${index}].message`}
                          validators={{
                            onChange: ({ value }) =>
                              value.trim()
                                ? undefined
                                : t('settings.snippets.messageRequired', 'Enter a message to send.'),
                          }}
                        >
                          {(message) => (
                            <Field data-invalid={message.state.meta.isTouched && !message.state.meta.isValid}>
                              <FieldLabel htmlFor={`${snippet.id}-message`}>
                                {t('settings.snippets.message', 'Message')}
                              </FieldLabel>
                              <Textarea
                                id={`${snippet.id}-message`}
                                value={message.state.value}
                                maxLength={4000}
                                rows={3}
                                placeholder={t(
                                  'settings.snippets.messagePlaceholder',
                                  'What would you like your Agent to do?'
                                )}
                                onBlur={message.handleBlur}
                                onChange={(event) => message.handleChange(event.target.value)}
                                aria-invalid={message.state.meta.isTouched && !message.state.meta.isValid}
                              />
                              {message.state.meta.isTouched && (
                                <FieldError>{message.state.meta.errors.join(' ')}</FieldError>
                              )}
                            </Field>
                          )}
                        </form.Field>
                        <form.Field name={`snippets[${index}].workMode`}>
                          {(mode) => (
                            <Field>
                              <FieldLabel htmlFor={`${snippet.id}-mode`}>
                                {t('session.workMode.label', 'Agent Modes')}
                              </FieldLabel>
                              <Select
                                items={modes}
                                value={mode.state.value}
                                onValueChange={(value) => {
                                  if (value) {
                                    mode.handleChange(value);
                                  }
                                }}
                              >
                                <SelectTrigger
                                  id={`${snippet.id}-mode`}
                                  className="w-full"
                                  onBlur={mode.handleBlur}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectGroup>
                                    {modes.map((item) => (
                                      <SelectItem key={item.value} value={item.value}>
                                        {item.label}
                                      </SelectItem>
                                    ))}
                                  </SelectGroup>
                                </SelectContent>
                              </Select>
                            </Field>
                          )}
                        </form.Field>
                        <form.Field name={`snippets[${index}].action`}>
                          {(action) => (
                            <Field>
                              <FieldLabel id={`${snippet.id}-action`}>
                                {t('settings.snippets.action', 'On click')}
                              </FieldLabel>
                              <ToggleGroup
                                aria-labelledby={`${snippet.id}-action`}
                                variant="outline"
                                value={[action.state.value]}
                                onBlur={action.handleBlur}
                                onValueChange={(values) => {
                                  const next = values[0];
                                  if (next === 'send' || next === 'fill') {
                                    action.handleChange(next);
                                  }
                                }}
                              >
                                <ToggleGroupItem value="send">
                                  {t('settings.snippets.send', 'Send')}
                                </ToggleGroupItem>
                                <ToggleGroupItem value="fill">
                                  {t('settings.snippets.fill', 'Fill')}
                                </ToggleGroupItem>
                              </ToggleGroup>
                            </Field>
                          )}
                        </form.Field>
                      </FieldGroup>
                    </div>
                  ))}
                </div>
              )}
            </form.Field>
            <form.Subscribe selector={(state) => [state.canSubmit, state.isDirty]}>
              {([canSubmit, isDirty]) => (
                <div className="flex justify-end">
                  <Button type="submit" disabled={!canSubmit || !isDirty}>
                    {t('common.save', 'Save')}
                  </Button>
                </div>
              )}
            </form.Subscribe>
          </form>
        </CardContent>
      </Card>
    </SettingContainer>
  );
}
