/**
 * @author Codex
 * @description Provides inline Provider API Key and OAuth authentication without reflecting stored secrets.
 */

import { useEffect, useRef, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { LogInIcon, TriangleAlertIcon, Undo2Icon, UserRoundCheckIcon } from 'lucide-react';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@octopus/ui/components/alert';
import { Button } from '@octopus/ui/components/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@octopus/ui/components/field';
import { Input } from '@octopus/ui/components/input';
import { Separator } from '@octopus/ui/components/separator';
import { Spinner } from '@octopus/ui/components/spinner';
import { toast } from '@octopus/ui/components/toast';
import { answerProviderAuthPrompt, cancelProviderAuthSession, getProviderAuthSession } from '@/api/settings';
import {
  isProviderAuthSessionTerminal,
  useCreateProviderAuthSession,
  useProviderAuthSession,
  useProviderAuthSessionCleanup,
} from '@/queries/provider-auth-queries';
import { queryKeys } from '@/queries/query-keys';
import { ProviderAuthMethodSelect } from './ProviderAuthMethodSelect';
import { ProviderAuthReset } from './ProviderAuthReset';
import { ProviderAuthSessionContent } from './ProviderAuthSessionContent';
import { canSubmitProviderAuth, isProviderAuthMethodActive } from './provider-auth-view-state';
import { useI18n } from '@/i18n/use-i18n';
import type { Translate } from '@/i18n/use-i18n';
import type {
  ModelProviderAuthMethod,
  ModelProviderDetailDto,
  ProviderAuthSessionDto,
} from '@octopus/shared/protocol';
import type { QueryClient } from '@tanstack/react-query';

const API_KEY_PROMPT_WAIT_MS = 250;

export interface ProviderAuthFormProps {
  provider: ModelProviderDetailDto;
}

/**
 * Renders authentication as part of the Provider details form and keeps API Keys write-only.
 */
export function ProviderAuthForm({ provider }: ProviderAuthFormProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const defaultMethod = provider.auth.activeMethod ?? provider.auth.methods[0] ?? null;
  const [authSessionId, setAuthSessionId] = useState<string>();
  const [submissionError, setSubmissionError] = useState<Error>();
  const [submittingApiKey, setSubmittingApiKey] = useState(false);
  const sessionIdRef = useRef<string | undefined>(undefined);
  const handledTerminalRevision = useRef<number | undefined>(undefined);
  const createSession = useCreateProviderAuthSession(provider.providerKey);
  const sessionQuery = useProviderAuthSession(provider.providerKey, authSessionId, true);
  const cleanup = useProviderAuthSessionCleanup(provider.providerKey);
  const session = sessionQuery.data;
  const sessionActive = session !== undefined && !isProviderAuthSessionTerminal(session.status);
  const form = useForm({
    defaultValues: {
      authType: defaultMethod as ModelProviderAuthMethod | null,
      apiKey: '',
    },
    onSubmit: async ({ value }) => {
      if (value.authType === null) {
        return;
      }
      setSubmissionError(undefined);
      let startedSessionId: string | undefined;
      try {
        const snapshot = await createSession.mutateAsync(value.authType);
        startedSessionId = snapshot.id;
        sessionIdRef.current = snapshot.id;
        setAuthSessionId(snapshot.id);
        if (value.authType === 'api_key') {
          setSubmittingApiKey(true);
          await submitApiKey(provider.providerKey, snapshot, () => value.apiKey, queryClient, t);
        }
      } catch (cause) {
        if (startedSessionId !== undefined && value.authType === 'api_key') {
          await cancelProviderAuthSession(provider.providerKey, startedSessionId).catch(() => undefined);
          cleanup.remove(startedSessionId);
          sessionIdRef.current = undefined;
          setAuthSessionId(undefined);
        }
        setSubmissionError(
          cause instanceof Error
            ? cause
            : new Error(t('settings.providers.auth.failed', 'Provider authentication could not be completed.'))
        );
      } finally {
        setSubmittingApiKey(false);
        form.setFieldValue('apiKey', '');
      }
    },
  });

  useEffect(() => {
    sessionIdRef.current = authSessionId;
  }, [authSessionId]);

  useEffect(() => {
    if (session === undefined || !isProviderAuthSessionTerminal(session.status)) {
      return;
    }
    if (handledTerminalRevision.current === session.revision) {
      return;
    }
    handledTerminalRevision.current = session.revision;
    if (session.status === 'completed' || session.status === 'committed_but_unsynced') {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.modelProviders }),
        queryClient.invalidateQueries({ queryKey: queryKeys.modelProvider(provider.providerKey) }),
      ]);
    }
    if (session.status === 'completed') {
      toast.add({
        title: t('settings.providers.auth.successTitle', 'Authentication successful'),
        description: t('settings.providers.auth.successDescription', 'Credentials for {{name}} were saved securely.', {
          name: provider.name,
        }),
        type: 'success',
      });
    }
  }, [provider.name, provider.providerKey, queryClient, session, t]);

  useEffect(
    () => () => {
      const sessionId = sessionIdRef.current;
      if (sessionId !== undefined) {
        void cancelProviderAuthSession(provider.providerKey, sessionId).catch(() => undefined);
        queryClient.removeQueries({
          queryKey: queryKeys.providerAuthSession(provider.providerKey, sessionId),
          exact: true,
        });
      }
    },
    [provider.providerKey, queryClient]
  );

  /**
   * Cancels the current inline authentication operation and clears its transient snapshot.
   */
  const cancelAuthentication = async (): Promise<void> => {
    if (authSessionId === undefined) {
      return;
    }
    try {
      await cleanup.cancel(authSessionId);
    } finally {
      cleanup.remove(authSessionId);
      sessionIdRef.current = undefined;
      setAuthSessionId(undefined);
      setSubmittingApiKey(false);
      handledTerminalRevision.current = undefined;
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit().catch(() => undefined);
        }}
      >
        <FieldGroup>
          <form.Field name="authType">
            {(field) => (
              <ProviderAuthMethodSelect
                methods={provider.auth.methods}
                value={field.state.value}
                onChange={(method) => {
                  field.handleChange(method);
                  setSubmissionError(undefined);
                }}
                disabled={sessionActive || createSession.isPending || submittingApiKey}
              />
            )}
          </form.Field>
          <form.Subscribe selector={(state) => state.values.authType}>
            {(authType) =>
              authType === 'api_key' ? (
                <form.Field
                  name="apiKey"
                  validators={{
                    onSubmit: ({ value, fieldApi }) =>
                      fieldApi.form.getFieldValue('authType') === 'api_key' && value.length === 0
                        ? t('settings.providers.auth.apiKeyRequired', 'Enter an API Key.')
                        : undefined,
                  }}
                >
                  {(field) => (
                    <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
                      <FieldLabel htmlFor="provider-api-key" className="text-xs text-muted-foreground">
                        {t('settings.providers.auth.apiKeyLabel', 'API Key')}
                      </FieldLabel>
                      <Input
                        id="provider-api-key"
                        type="password"
                        autoComplete="new-password"
                        value={field.state.value}
                        placeholder={apiKeyPlaceholder(provider, t)}
                        disabled={sessionActive || createSession.isPending || submittingApiKey}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                        aria-invalid={field.state.meta.errors.length > 0 || undefined}
                      />
                      <FieldDescription className="text-xs">
                        {t(
                          'settings.providers.auth.apiKeyDescription',
                          'For security, a saved API Key is never refilled; entering a new value replaces the existing credential.'
                        )}
                      </FieldDescription>
                      <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
                    </Field>
                  )}
                </form.Field>
              ) : authType === 'oauth' ? (
                <>
                  {isProviderAuthMethodActive(provider.auth, authType) ? (
                    <Alert>
                      <UserRoundCheckIcon />
                      <AlertTitle>{t('settings.providers.auth.oauthActiveTitle', 'OAuth signed in')}</AlertTitle>
                      <AlertDescription className="text-xs">
                        {t('settings.providers.auth.oauthActiveDescription', 'Provider {{name}} is authenticated via OAuth.', {
                          name: provider.name,
                        })}
                      </AlertDescription>
                      <AlertAction>
                        <ProviderAuthReset
                          provider={provider}
                          disabled={sessionActive || createSession.isPending || submittingApiKey}
                        />
                      </AlertAction>
                    </Alert>
                  ) : (
                    <Alert>
                      <LogInIcon />
                      <AlertTitle>{t('settings.providers.auth.oauthTitle', 'OAuth authentication')}</AlertTitle>
                      <AlertDescription className="text-xs">
                        {t(
                          'settings.providers.auth.oauthDescription',
                          'After submitting, follow the provider instructions to open the authorization page and sign in.'
                        )}
                      </AlertDescription>
                    </Alert>
                  )}
                </>
              ) : null
            }
          </form.Subscribe>
          {submissionError && (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle>{t('settings.providers.auth.submissionFailed', 'Authentication failed')}</AlertTitle>
              <AlertDescription>{submissionError.message}</AlertDescription>
            </Alert>
          )}
          <form.Subscribe
            selector={(state) => ({
              authType: state.values.authType,
              apiKey: state.values.apiKey,
              canSubmit: state.canSubmit,
            })}
          >
            {({ authType, apiKey, canSubmit }) =>
              canSubmitProviderAuth(provider.auth, authType) ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="submit"
                    disabled={
                      !canSubmit ||
                      authType === null ||
                      (authType === 'api_key' && apiKey.length === 0) ||
                      sessionActive ||
                      createSession.isPending ||
                      submittingApiKey
                    }
                  >
                    {createSession.isPending || submittingApiKey ? (
                      <Spinner data-icon="inline-start" />
                    ) : null}
                    {authType === 'oauth'
                      ? t('settings.providers.auth.oauthButton', 'Authenticate with OAuth')
                      : t('settings.providers.auth.saveApiKey', 'Save API Key')}
                  </Button>
                  {sessionActive && (
                    <Button type="button" variant="outline" onClick={() => void cancelAuthentication()}>
                      <Undo2Icon data-icon="inline-start" />
                      {t('settings.providers.auth.cancelNow', 'Cancel now')}
                    </Button>
                  )}
                </div>
              ) : null
            }
          </form.Subscribe>
        </FieldGroup>
      </form>
      {authSessionId === undefined ? null : (
        <>
          <Separator />
          <ProviderAuthSessionContent
            providerKey={provider.providerKey}
            session={session}
            pending={sessionQuery.isPending}
            error={sessionQuery.error instanceof Error ? sessionQuery.error : undefined}
            hidePrompt={submittingApiKey}
            onRetry={() => void sessionQuery.refetch()}
          />
        </>
      )}
    </div>
  );
}

/**
 * Returns a non-secret placeholder that reflects whether an API Key is already configured.
 */
function apiKeyPlaceholder(provider: ModelProviderDetailDto, t: Translate): string {
  return provider.auth.configured && provider.auth.activeMethod === 'api_key'
    ? t('settings.providers.auth.apiKeyConfiguredPlaceholder', 'sk-*************** (configured)')
    : t('settings.providers.auth.apiKeyPlaceholder', 'Enter an API Key');
}

/**
 * Waits for Pi's API Key prompt and answers it from the transient form submission closure.
 */
async function submitApiKey(
  providerKey: string,
  initialSnapshot: ProviderAuthSessionDto,
  readApiKey: () => string,
  queryClient: QueryClient,
  t: Translate
): Promise<void> {
  let snapshot = initialSnapshot;
  while (!isProviderAuthSessionTerminal(snapshot.status) && snapshot.prompt === undefined) {
    await new Promise<void>((resolve) => setTimeout(resolve, API_KEY_PROMPT_WAIT_MS));
    snapshot = await getProviderAuthSession(providerKey, snapshot.id);
    queryClient.setQueryData(queryKeys.providerAuthSession(providerKey, snapshot.id), snapshot);
  }
  if (snapshot.prompt === undefined) {
    throw new Error(
      snapshot.error?.message ?? t('settings.providers.auth.noApiKeyPrompt', 'The provider did not request an API Key.')
    );
  }
  const answered = await answerProviderAuthPrompt(providerKey, snapshot.id, {
    promptId: snapshot.prompt.id,
    answer: readApiKey(),
  });
  queryClient.setQueryData(queryKeys.providerAuthSession(providerKey, snapshot.id), answered);
}
