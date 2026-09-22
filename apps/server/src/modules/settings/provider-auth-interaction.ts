/**
 * @author Codex
 * @description Bridges Pi authentication prompts and events into one bounded in-memory session record.
 */

import { touchProviderAuthSession } from './provider-auth-session-model.js';
import { ApplicationError } from '../../lib/errors/application-error.js';
import {
  sanitizeProviderAuthEvent,
  sanitizeProviderAuthPrompt,
  trimProviderAuthEvents,
} from './provider-auth-session-model.js';
import type { PiProviderAuthEvent, PiProviderAuthPrompt } from '../../lib/pi-settings/index.js';
import type { ProviderAuthSessionRecord } from './provider-auth-session-model.js';

/**
 * Publishes one Pi prompt and waits for an HTTP answer or prompt cancellation.
 *
 * @param record Mutable session record owned by the manager.
 * @param prompt Provider-owned Pi prompt.
 * @param createId Opaque prompt identity factory.
 * @returns Transient answer supplied by the browser.
 */
export function requestProviderAuthAnswer(
  record: ProviderAuthSessionRecord,
  prompt: PiProviderAuthPrompt,
  createId: () => string
): Promise<string> {
  if (!isActive(record) || record.currentPrompt !== undefined) {
    return Promise.reject(
      new ApplicationError(
        'MODEL_PROVIDER_AUTH_PROTOCOL_VIOLATION',
        'The Provider opened overlapping authentication prompts.',
        { statusCode: 502 }
      )
    );
  }
  const dto = sanitizeProviderAuthPrompt(prompt, createId());
  return new Promise<string>((resolve, reject) => {
    const onAbort = (): void => {
      const pending = record.currentPrompt;
      if (pending === undefined || pending.dto.id !== dto.id || pending.settled) {
        return;
      }
      pending.settled = true;
      record.currentPrompt = undefined;
      if (isActive(record)) {
        record.status = 'running';
        touchProviderAuthSession(record);
      }
      reject(new DOMException('Authentication prompt was cancelled.', 'AbortError'));
    };
    prompt.signal?.addEventListener('abort', onAbort, { once: true });
    record.currentPrompt = {
      dto,
      resolve,
      reject,
      settled: false,
      detachAbort: () => prompt.signal?.removeEventListener('abort', onAbort),
    };
    record.status = 'awaiting_input';
    touchProviderAuthSession(record);
  });
}

/**
 * Appends one bounded, non-secret Pi authentication event.
 *
 * @param record Mutable session record owned by the manager.
 * @param event Provider-owned Pi event.
 * @param now Current epoch timestamp used for derived expiry.
 */
export function appendProviderAuthEvent(
  record: ProviderAuthSessionRecord,
  event: PiProviderAuthEvent,
  now: number
): void {
  if (!isActive(record)) {
    return;
  }
  record.events.push(sanitizeProviderAuthEvent(event, (record.events.at(-1)?.seq ?? 0) + 1, now));
  trimProviderAuthEvents(record.events);
  touchProviderAuthSession(record);
}

/**
 * Identifies a record that still accepts Pi interaction updates.
 */
function isActive(record: ProviderAuthSessionRecord): boolean {
  return record.status === 'running' || record.status === 'awaiting_input';
}
