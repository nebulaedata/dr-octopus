/**
 * @author Codex
 * @description Renders the four standard Pi Extension UI requests as an inline Questionnaire above the Agent Composer.
 */

import { useState } from 'react';
import { useStore } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { Button } from '@octopus/ui/components/button';
import { Input } from '@octopus/ui/components/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@octopus/ui/components/card';
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from '@octopus/ui/components/questionnaire';
import { Textarea } from '@octopus/ui/components/textarea';
import { useRealtimeCommand } from '@/hooks/use-realtime';
import { useI18n } from '@/i18n/use-i18n';
import { sessionStores } from '@/stores/session';
import {
  encodeRpivMultipleResponse,
  getDisplayCopy,
  getDisplayOptions,
  getImmediateSelectValue,
  getRpivMultipleQuestionnaire,
} from './extension-dialog-model';
import type { HostEventEnvelope } from '@octopus/shared/protocol';
import type { ExtensionRequestPayload } from './extension-dialog-model';

/**
 * Responds only to the oldest pending request and invalidates it after one response.
 */
export function ExtensionDialogHost({
  sessionId,
  runtimeId,
  epoch,
}: {
  sessionId: string;
  runtimeId?: string;
  epoch?: number;
}) {
  const store = sessionStores.ensure(sessionId);
  const pending = useStore(store, (state) => state.pendingExtensionUi);
  const send = useRealtimeCommand();
  const event = pending[0];
  const payload = event?.payload as (Omit<ExtensionRequestPayload, 'id'> & { id?: string }) | undefined;
  if (event === undefined || payload?.id === undefined) {
    return null;
  }
  return (
    <ExtensionRequestQuestionnaire
      key={payload.id}
      sessionId={sessionId}
      runtimeId={runtimeId}
      epoch={epoch}
      pending={pending}
      payload={{ ...payload, id: payload.id }}
      send={send}
    />
  );
}

/**
 * Owns transient editor state for exactly one Extension request identity.
 */
function ExtensionRequestQuestionnaire({
  sessionId,
  runtimeId,
  epoch,
  pending,
  payload,
  send,
}: {
  sessionId: string;
  runtimeId?: string;
  epoch?: number;
  pending: HostEventEnvelope[];
  payload: ExtensionRequestPayload;
  send: ReturnType<typeof useRealtimeCommand>;
}) {
  const store = sessionStores.ensure(sessionId);
  const { t } = useI18n();
  const [value, setValue] = useState(payload.prefill ?? '');
  const [customAnswer, setCustomAnswer] = useState('');
  const [selectedOptionIds, setSelectedOptionIds] = useState<Set<string>>(() => new Set());
  const method = payload.method;
  const rpivMultiple = getRpivMultipleQuestionnaire(payload);
  const selectable = method === 'select' || method === 'confirm' || rpivMultiple !== undefined;
  const options = getDisplayOptions(payload);
  const copy = getDisplayCopy(payload);
  const items = [
    {
      name: 'response',
      required: selectable && rpivMultiple === undefined,
      multiple: rpivMultiple !== undefined,
      ...(selectable ? { choices: options.map((option) => ({ value: option.value })) } : {}),
    },
  ] as const;

  /**
   * Binds the response to the originating runtime and removes the fulfilled request.
   */
  function respond(response: { value?: string; confirmed?: boolean; cancelled?: true }): void {
    send({
      type: 'extension.ui.response',
      requestId: uuidv4(),
      sessionId,
      runtimeId,
      epoch,
      payload: { extensionRequestId: payload.id, ...response },
    });
    store.setState({ pendingExtensionUi: pending.slice(1) });
  }

  /**
   * Submits every Pi select choice immediately so any subsequent Extension request can replace it.
   */
  function submitSelectOption(optionValue: string, checked: boolean): void {
    if (rpivMultiple !== undefined) {
      setCustomAnswer('');
      setSelectedOptionIds((current) => {
        const next = new Set(current);
        if (checked) {
          next.add(optionValue);
        } else {
          next.delete(optionValue);
        }
        return next;
      });
      return;
    }
    if (!checked) {
      return;
    }
    const selectedValue = getImmediateSelectValue(payload, optionValue);
    if (selectedValue !== undefined) {
      respond({ value: selectedValue });
    }
  }

  /**
   * Converts the Questionnaire form value back into the exact Pi dialog response shape.
   */
  function submit(event: React.SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (rpivMultiple !== undefined) {
      const encoded = encodeRpivMultipleResponse(rpivMultiple, selectedOptionIds, customAnswer);
      if (encoded !== undefined) {
        respond({ value: encoded });
      }
      return;
    }
    if (method === 'editor') {
      respond({ value });
      return;
    }
    const formValue = new FormData(event.currentTarget).get('response');
    if (typeof formValue !== 'string') {
      return;
    }
    if (method === 'confirm') {
      respond({ confirmed: formValue === 'yes' });
      return;
    }
    if (method === 'select') {
      const selectedValue = getImmediateSelectValue(payload, formValue);
      if (selectedValue !== undefined) {
        respond({ value: selectedValue });
      }
      return;
    }
    respond({ value: formValue });
  }

  return (
    <div
      aria-live="assertive"
      className="mb-2 drop-shadow-[0_12px_28px_color-mix(in_oklch,var(--foreground)_10%,transparent)]"
    >
      <Questionnaire defaultItem="response" items={items} shortcuts="numbers" onSubmit={submit}>
        <QuestionnaireItem
          name="response"
          required={selectable && rpivMultiple === undefined}
          multiple={rpivMultiple !== undefined}
        >
          <Card>
            <CardHeader>
              <QuestionnaireTitle render={<CardTitle />}>
                <span className="whitespace-pre-wrap">{copy.title}</span>
              </QuestionnaireTitle>
              <QuestionnaireDescription className="whitespace-pre-wrap" render={<CardDescription />}>
                {copy.description}
              </QuestionnaireDescription>
            </CardHeader>
            <CardContent>
              {selectable ? (
                <QuestionnaireChoices>
                  {options.map((option) => (
                    <QuestionnaireChoice
                      key={option.value}
                      value={option.value}
                      checked={rpivMultiple === undefined ? undefined : selectedOptionIds.has(option.value)}
                      onChange={(event) => submitSelectOption(option.value, event.currentTarget.checked)}
                    >
                      <span className="font-medium">{option.label}</span>
                      {option.description !== undefined && (
                        <QuestionnaireChoiceDescription>{option.description}</QuestionnaireChoiceDescription>
                      )}
                    </QuestionnaireChoice>
                  ))}
                </QuestionnaireChoices>
              ) : method === 'editor' ? (
                <Textarea
                  aria-label="Extension response"
                  autoFocus
                  placeholder={payload.placeholder}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                />
              ) : (
                <QuestionnaireInput
                  aria-label="Extension response"
                  autoFocus
                  defaultValue={payload.prefill}
                  placeholder={payload.placeholder}
                />
              )}
              {rpivMultiple !== undefined && (
                <Input
                  aria-label="Custom answer"
                  className="mt-2"
                  placeholder={t(
                    'session.extensionDialog.customAnswerPlaceholder',
                    'Type another answer (optional)…'
                  )}
                  value={customAnswer}
                  onChange={(event) => {
                    const next = event.target.value;
                    setCustomAnswer(next);
                    if (next.trim() !== '') {
                      setSelectedOptionIds(new Set());
                    }
                  }}
                />
              )}
              <QuestionnaireError />
            </CardContent>
            <CardFooter>
              <QuestionnaireActions>
                <Button type="button" variant="outline" onClick={() => respond({ cancelled: true })}>
                  {t('common.cancel', 'Cancel')}
                </Button>
                {(method !== 'select' || rpivMultiple !== undefined) && (
                  <QuestionnaireSubmit>
                    {method === 'confirm'
                      ? t('session.extensionDialog.submitRespond', 'Respond')
                      : t('session.extensionDialog.submitContinue', 'Continue')}
                  </QuestionnaireSubmit>
                )}
              </QuestionnaireActions>
            </CardFooter>
          </Card>
        </QuestionnaireItem>
      </Questionnaire>
    </div>
  );
}
