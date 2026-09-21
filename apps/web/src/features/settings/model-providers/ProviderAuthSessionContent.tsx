/**
 * @author Codex
 * @description Presents Provider authentication progress, safe external actions, prompts, and terminal results.
 */

import { copyTextWithFeedback } from '@/lib/copy-text-with-feedback';
import { CheckCircleIcon, CopyIcon, ExternalLinkIcon, KeyRoundIcon, TriangleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@octopus/ui/components/alert';
import { Badge } from '@octopus/ui/components/badge';
import { Button } from '@octopus/ui/components/button';
import { Separator } from '@octopus/ui/components/separator';
import { Spinner } from '@octopus/ui/components/spinner';
import { isProviderAuthSessionTerminal } from '@/queries/provider-auth-queries';
import { ProviderAuthPromptForm } from './ProviderAuthPromptForm';
import { useI18n } from '@/i18n/use-i18n';
import type { Translate } from '@/i18n/use-i18n';
import type { AuthSessionEventDto, ProviderAuthSessionDto } from '@octopus/shared/protocol';

export interface ProviderAuthSessionContentProps {
  providerKey: string;
  session?: ProviderAuthSessionDto;
  pending: boolean;
  hidePrompt?: boolean;
  error?: Error;
  /**
   * Retries the current authentication snapshot query.
   */
  onRetry(): void;
}

/**
 * Renders one active or terminal authentication session without owning secret state.
 */
export function ProviderAuthSessionContent({
  providerKey,
  session,
  pending,
  hidePrompt = false,
  error,
  onRetry,
}: ProviderAuthSessionContentProps) {
  const { t } = useI18n();
  if (error !== undefined) {
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>{t('settings.providers.auth.loadFailedTitle', 'Failed to load authentication status')}</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-3">
          <span>{error.message}</span>
          <Button variant="outline" size="sm" onClick={onRetry}>
            {t('common.retry', 'Retry')}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  if (pending || session === undefined) {
    return (
      <div className="flex min-h-36 items-center justify-center gap-2 text-muted-foreground">
        <Spinner />
        {t('settings.providers.auth.starting', 'Starting authentication…')}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Badge variant="outline">{session.authType === 'api_key' ? 'API Key' : 'OAuth'}</Badge>
        <Badge variant="secondary">{authStatusLabel(t, session.status)}</Badge>
      </div>
      {session.events.length > 0 ? (
        <div className="flex flex-col gap-3">
          {session.events.map((event) => (
            <ProviderAuthEvent key={event.seq} event={event} />
          ))}
        </div>
      ) : null}
      {session.prompt === undefined || hidePrompt ? null : (
        <>
          <Separator />
          <ProviderAuthPromptForm
            key={session.prompt.id}
            providerKey={providerKey}
            authSessionId={session.id}
            prompt={session.prompt}
          />
        </>
      )}
      <ProviderAuthResult session={session} />
      {!isProviderAuthSessionTerminal(session.status) && (session.prompt === undefined || hidePrompt) ? (
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <Spinner />
          {t('settings.providers.auth.waiting', 'Waiting for the provider to return the next step…')}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Renders one Provider-owned informational event as plain text and explicit actions.
 */
function ProviderAuthEvent({ event }: { event: AuthSessionEventDto }) {
  const { t } = useI18n();
  if (event.type === 'auth_url') {
    const url = safeHttpUrl(event.url);
    return (
      <Alert>
        <ExternalLinkIcon />
        <AlertTitle>{t('settings.providers.auth.browserTitle', 'Finish authorization in the browser')}</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-3">
          {event.instructions === undefined ? null : <span>{event.instructions}</span>}
          {url === undefined ? (
            <span>
              {t('settings.providers.auth.unsupportedUrl', 'The provider returned an unsupported authorization URL.')}
            </span>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
            >
              <ExternalLinkIcon data-icon="inline-start" />
              {t('settings.providers.auth.openAuthPage', 'Open authorization page')}
            </Button>
          )}
        </AlertDescription>
      </Alert>
    );
  }
  if (event.type === 'device_code') {
    const url = safeHttpUrl(event.verificationUri);
    return (
      <Alert>
        <KeyRoundIcon />
        <AlertTitle>
          {t('settings.providers.auth.deviceCodeTitle', 'Device code: {{code}}', { code: event.userCode })}
        </AlertTitle>
        <AlertDescription className="flex flex-wrap gap-2 mt-2">
          <Button
            variant="outline"
            size="xs"
            onClick={() => void copyTextWithFeedback(event.userCode)}
          >
            <CopyIcon data-icon="inline-start" />
            {t('settings.providers.auth.copyCode', 'Copy code')}
          </Button>
          {url === undefined ? null : (
            <Button
              variant="outline"
              size="xs"
              onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
            >
              <ExternalLinkIcon data-icon="inline-start" />
              {t('settings.providers.auth.openVerification', 'Open verification page')}
            </Button>
          )}
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert>
      <AlertTitle>
        {event.type === 'progress'
          ? t('settings.providers.auth.progressTitle', 'Authentication progress')
          : t('settings.providers.auth.promptTitle', 'Provider message')}
      </AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        <span>{event.message}</span>
        {event.type === 'info'
          ? event.links?.map((link) => {
              const url = safeHttpUrl(link.url);
              return url === undefined ? null : (
                <Button
                  key={url}
                  variant="link"
                  size="sm"
                  className="h-auto px-0"
                  onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
                >
                  <ExternalLinkIcon data-icon="inline-start" />
                  {link.label ?? t('settings.providers.auth.openProviderLink', 'Open provider link')}
                </Button>
              );
            })
          : null}
      </AlertDescription>
    </Alert>
  );
}

/**
 * Renders terminal authentication outcomes without exposing internal Provider errors.
 */
function ProviderAuthResult({ session }: { session: ProviderAuthSessionDto }) {
  const { t } = useI18n();
  if (session.status === 'completed') {
    return (
      <Alert>
        <CheckCircleIcon />
        <AlertTitle>{t('settings.providers.auth.completedTitle', 'Authentication complete')}</AlertTitle>
        <AlertDescription>
          {t(
            'settings.providers.auth.completedDescription',
            'Provider credentials saved; model availability refreshed.'
          )}
        </AlertDescription>
      </Alert>
    );
  }
  if (session.status === 'committed_but_unsynced') {
    return (
      <Alert>
        <TriangleAlertIcon />
        <AlertTitle>
          {t('settings.providers.auth.unsyncedTitle', 'Credentials saved, but status not synced yet')}
        </AlertTitle>
        <AlertDescription>
          {t(
            'settings.providers.auth.unsyncedDescription',
            'Refresh the provider; restart the service if it does not recover.'
          )}
        </AlertDescription>
      </Alert>
    );
  }
  if (session.status === 'failed' || session.status === 'expired' || session.status === 'cancelled') {
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>{authStatusLabel(t, session.status)}</AlertTitle>
        <AlertDescription>
          {session.error?.message ?? t('settings.providers.auth.retryHint', 'Start authentication again.')}
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}

/**
 * Maps the closed authentication status set to concise user-facing copy.
 */
function authStatusLabel(t: Translate, status: ProviderAuthSessionDto['status']): string {
  const labels: Record<ProviderAuthSessionDto['status'], string> = {
    running: t('settings.providers.auth.status.running', 'Authenticating…'),
    awaiting_input: t('settings.providers.auth.status.awaitingInput', 'Waiting for input'),
    completed: t('settings.providers.auth.status.completed', 'Authenticated'),
    failed: t('settings.providers.auth.status.failed', 'Authentication failed'),
    committed_but_unsynced: t('settings.providers.auth.status.unsynced', 'Waiting to sync'),
    cancelled: t('settings.providers.auth.status.cancelled', 'Cancelled'),
    expired: t('settings.providers.auth.status.expired', 'Expired'),
  };
  return labels[status];
}

/**
 * Allows only explicit HTTP(S) links supplied by Provider authentication events.
 */
function safeHttpUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
