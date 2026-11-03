/**
 * @author Codex
 * @description Renders only the pending agent question with controlled TanStack fields and no free-chat composer.
 */
import { useRef, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { Field, FieldGroup, FieldError } from '@octopus/ui/components/field';
import {
  Questionnaire,
  QuestionnaireItem,
  QuestionnaireTitle,
  QuestionnaireChoices,
  QuestionnaireChoice,
  QuestionnaireInput,
} from '@octopus/ui/components/questionnaire';
import { Alert } from '@octopus/custom-ui/components/alert';
import { Button } from '@octopus/ui/components/button';
import {
  validateSkillAnswer,
  isFieldExplanation,
  type SkillFieldExplanation,
  type SkillAnswerValue,
  type SkillQuestion,
  type SkillAnswer,
} from '../../lib/builtin-agent/skill-question';
import { skillError } from '../../lib/builtin-agent/skill-messages';
import { AgentDatePicker } from './AgentDatePicker';

/**
 * Keeps all related fields inside one tool-bound form; acknowledgements, not local clicks, complete the question.
 */
export function AgentQuestionForm({
  id,
  question,
  submit,
  busy,
}: {
  id: string;
  question: SkillQuestion;
  submit: (submissionId: string, answer: SkillAnswer) => Promise<void>;
  busy: boolean;
}) {
  const submissionId = useRef(crypto.randomUUID());
  const [error, setError] = useState('');
  const defaults: Record<string, string | string[] | SkillFieldExplanation> = Object.fromEntries(
    question.fields.map((field) => [field.id, field.type === 'multiple' ? [] : ''])
  );
  const form = useForm({
    defaultValues: defaults,
    onSubmit: async ({ value }) => {
      try {
        const values: Record<string, SkillAnswerValue> = { ...value };
        for (const field of question.fields) {
          if (field.type === 'number' && typeof value[field.id] === 'string' && value[field.id] !== '') {
            values[field.id] = Number(value[field.id]);
          }
        }
        const answer = validateSkillAnswer(question, { status: 'answered', values });
        setError('');
        await submit(submissionId.current, answer);
      } catch (failure) {
        setError(skillError(failure instanceof Error ? failure.message : 'SKILL_ANSWER_INVALID'));
      }
    },
  });
  return (
    <Questionnaire
      id={id}
      noValidate
      onSubmitCapture={(event) => {
        // One tool may contain several fields. TanStack and Worker own validation, including optional empty fields.
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <h3 className="text-sm font-medium">{question.question}</h3>
      {question.reason && <p className="text-sm text-muted-foreground">{question.reason}</p>}
      <FieldGroup className="gap-4">
        {question.fields.map((definition) => (
          <form.Field
            key={definition.id}
            name={definition.id}
            validators={{
              onSubmit: ({ value }) => {
                if (isFieldExplanation(value) && !value.text.trim()) {
                  return '请填写说明，告诉智能体如何调整。';
                }
                try {
                  let parsed: SkillAnswerValue = value;
                  if (definition.type === 'number' && typeof value === 'string' && value !== '') {
                    parsed = Number(value);
                  }
                  validateSkillAnswer(
                    { ...question, fields: [definition] },
                    {
                      status: 'answered',
                      values: { [definition.id]: parsed },
                    }
                  );
                  return undefined;
                } catch (failure) {
                  return skillError(failure instanceof Error ? failure.message : 'SKILL_ANSWER_INVALID');
                }
              },
            }}
          >
            {(field) => (
              <QuestionnaireItem
                name={definition.id}
                multiple={definition.type === 'multiple'}
                required={definition.required && !isFieldExplanation(field.state.value)}
                hidden={false}
                inert={false}
                invalid={field.state.meta.errors.length > 0}
              >
                <QuestionnaireTitle className="text-sm [&:not(:has(~[data-slot=questionnaire-description]))]:mb-2">
                  {definition.label}
                </QuestionnaireTitle>
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  {definition.type === 'single' || definition.type === 'multiple' ? (
                    <QuestionnaireChoices
                      role={definition.type === 'single' ? 'radiogroup' : 'group'}
                      aria-label={definition.label}
                    >
                      {definition.options.map((option) => (
                        <QuestionnaireChoice
                          key={option.id}
                          className="min-h-8 gap-2 px-2.5 py-1"
                          value={option.id}
                          disabled={busy}
                          aria-invalid={field.state.meta.errors.length > 0}
                          onBlur={field.handleBlur}
                          checked={
                            definition.type === 'single'
                              ? field.state.value === option.id
                              : Array.isArray(field.state.value) && field.state.value.includes(option.id)
                          }
                          onChange={(event) => {
                            if (definition.type === 'single') {
                              if (event.target.checked) {
                                field.handleChange(option.id);
                              }
                            } else {
                              const selected = Array.isArray(field.state.value) ? field.state.value : [];
                              field.handleChange(
                                event.target.checked
                                  ? [...selected, option.id]
                                  : selected.filter((value) => value !== option.id)
                              );
                            }
                          }}
                        >
                          {option.label}
                        </QuestionnaireChoice>
                      ))}
                      <QuestionnaireChoice
                        className="min-h-8 gap-2 px-2.5 py-1"
                        value="__explanation"
                        disabled={busy}
                        checked={isFieldExplanation(field.state.value)}
                        onChange={(event) =>
                          field.handleChange(
                            event.target.checked
                              ? { kind: 'explanation', text: '' }
                              : definition.type === 'multiple'
                                ? []
                                : ''
                          )
                        }
                      >
                        其他，自行说明
                      </QuestionnaireChoice>
                    </QuestionnaireChoices>
                  ) : null}
                  {definition.type === 'date' && !isFieldExplanation(field.state.value) && (
                    <AgentDatePicker
                      id={id + '-' + definition.id}
                      label={definition.label}
                      value={typeof field.state.value === 'string' ? field.state.value : ''}
                      disabled={busy}
                      invalid={field.state.meta.errors.length > 0}
                      onChange={field.handleChange}
                      onBlur={field.handleBlur}
                    />
                  )}
                  {definition.type !== 'single' &&
                    definition.type !== 'multiple' &&
                    definition.type !== 'date' &&
                    !isFieldExplanation(field.state.value) && (
                      <QuestionnaireInput
                        className="h-8 min-h-0 text-sm"
                        id={id + '-' + definition.id}
                        aria-label={definition.label}
                        disabled={busy}
                        type={definition.type}
                        value={typeof field.state.value === 'string' ? field.state.value : ''}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                        aria-invalid={field.state.meta.errors.length > 0}
                        autoComplete="off"
                      />
                    )}
                  {definition.type !== 'single' && definition.type !== 'multiple' && (
                    <Button
                      type="button"
                      variant="outline"
                      aria-pressed={isFieldExplanation(field.state.value)}
                      disabled={busy}
                      onClick={() =>
                        field.handleChange(
                          isFieldExplanation(field.state.value) ? '' : { kind: 'explanation', text: '' }
                        )
                      }
                    >
                      不适用／自行说明
                    </Button>
                  )}
                  {isFieldExplanation(field.state.value) && (
                    <QuestionnaireInput
                      className="h-8 min-h-0 text-sm"
                      aria-label={definition.label + '：自行说明'}
                      placeholder="例如：不需要此参数，请跳过这一项。"
                      maxLength={2000}
                      value={field.state.value.text}
                      disabled={busy}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange({ kind: 'explanation', text: event.target.value })
                      }
                      aria-invalid={field.state.meta.errors.length > 0}
                    />
                  )}
                  {field.state.meta.errors.length > 0 && (
                    <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
                  )}
                </Field>
              </QuestionnaireItem>
            )}
          </form.Field>
        ))}
      </FieldGroup>
      {error && <Alert variant="danger" description={error} />}
      {question.allowDefer && (
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            void submit(submissionId.current, { status: 'deferred' }).catch((failure: unknown) =>
              setError(skillError(failure instanceof Error ? failure.message : ''))
            );
          }}
        >
          暂不提供
        </Button>
      )}
    </Questionnaire>
  );
}
