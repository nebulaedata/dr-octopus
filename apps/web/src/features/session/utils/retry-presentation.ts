/**
 * @author Codex
 * @description Formats retry outcomes and countdowns using the active interface language.
 */
import type { Translate } from '@/i18n/use-i18n';
import type { AutoRetryProjection } from '@/stores/session';

/**
 * Counts attempts after the initial request and never shows a negative backoff countdown.
 */
export function formatRetryTitle(retry: AutoRetryProjection, now: number, t: Translate): string {
  if (retry.status === 'succeeded') {
    return t('session.retry.recovered', 'Recovered after {{count}} retry', {
      count: retry.attempt,
      defaultValue_other: 'Recovered after {{count}} retries',
    });
  }
  if (retry.status === 'failed') {
    return t('session.retry.failed', 'Failed after {{count}} retry', {
      count: retry.attempt,
      defaultValue_other: 'Failed after {{count}} retries',
    });
  }
  const progress =
    retry.maxAttempts === undefined
      ? t('session.retry.attempt', 'Retry {{attempt}}', { attempt: retry.attempt })
      : t('session.retry.attemptOf', 'Retry {{attempt}} of {{max}}', {
          attempt: retry.attempt,
          max: retry.maxAttempts,
        });
  if (retry.status === 'retrying') {
    return t('session.retry.inProgress', '{{progress}} in progress…', { progress });
  }
  const seconds = Math.max(0, Math.ceil((retry.scheduledAt + (retry.delayMs ?? 0) - now) / 1_000));
  return t('session.retry.waiting', '{{progress}} in {{seconds}}s…', { progress, seconds });
}
