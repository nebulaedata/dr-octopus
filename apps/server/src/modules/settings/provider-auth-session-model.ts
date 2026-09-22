/**
 * @author Codex
 * @description Defines and safely projects the internal state of a Provider authentication session.
 */

import { ApplicationError } from '../../lib/errors/application-error.js';
import type { PiProviderAuthEvent, PiProviderAuthPrompt } from '../../lib/pi-settings/index.js';
import type {
  AuthSessionEventDto,
  AuthSessionPromptDto,
  ModelProviderAuthMethod,
  ProviderAuthSessionDto,
  ProviderAuthSessionStatus,
} from '@octopus/shared/protocol';

const MAX_EVENTS = 32;
const MAX_TEXT_LENGTH = 4_096;
const MAX_SELECT_OPTIONS = 100;

export interface PendingProviderAuthPrompt {
  dto: AuthSessionPromptDto;
  /**
   * Resolves the Pi prompt with one transient answer.
   */
  resolve(answer: string): void;
  /**
   * Rejects the Pi prompt during cancellation or invalidation.
   */
  reject(error: Error): void;
  /**
   * Detaches the prompt-level AbortSignal listener.
   */
  detachAbort(): void;
  settled: boolean;
}

export interface ProviderAuthSessionRecord {
  /**
   * Publishes a non-secret revision hint after observable state changes.
   */
  onChanged?(): void;
  id: string;
  providerKey: string;
  providerId: string;
  authType: ModelProviderAuthMethod;
  status: ProviderAuthSessionStatus;
  revision: number;
  createdAt: number;
  expiresAt: number;
  terminalExpiresAt?: number;
  abortController: AbortController;
  currentPrompt?: PendingProviderAuthPrompt;
  acceptedPromptIds: Set<string>;
  events: AuthSessionEventDto[];
  result?: ProviderAuthSessionDto['result'];
  error?: ProviderAuthSessionDto['error'];
  task: Promise<void>;
}

/**
 * Converts one internal record into a detached public DTO.
 */
export function toProviderAuthSessionDto(record: ProviderAuthSessionRecord): ProviderAuthSessionDto {
  return {
    id: record.id,
    providerKey: record.providerKey,
    providerId: record.providerId,
    authType: record.authType,
    status: record.status,
    revision: record.revision,
    createdAt: new Date(record.createdAt).toISOString(),
    expiresAt: new Date(record.expiresAt).toISOString(),
    ...(record.currentPrompt === undefined ? {} : { prompt: structuredClone(record.currentPrompt.dto) }),
    events: structuredClone(record.events),
    ...(record.result === undefined ? {} : { result: { ...record.result } }),
    ...(record.error === undefined ? {} : { error: { ...record.error } }),
  };
}

/**
 * Sanitizes a Provider prompt before exposing it through event-driven snapshots.
 */
export function sanitizeProviderAuthPrompt(prompt: PiProviderAuthPrompt, id: string): AuthSessionPromptDto {
  const base = {
    id,
    type: prompt.type,
    message: boundedText(prompt.message),
    ...('placeholder' in prompt && prompt.placeholder !== undefined
      ? { placeholder: boundedText(prompt.placeholder) }
      : {}),
  };
  if (prompt.type !== 'select') {
    return base;
  }
  if (prompt.options.length > MAX_SELECT_OPTIONS) {
    throw new ApplicationError(
      'MODEL_PROVIDER_AUTH_PROTOCOL_VIOLATION',
      'The Provider returned too many authentication options.',
      { statusCode: 502 }
    );
  }
  return {
    ...base,
    options: prompt.options.map((option) => ({
      id: boundedText(option.id),
      label: boundedText(option.label),
      ...(option.description === undefined ? {} : { description: boundedText(option.description) }),
    })),
  };
}

/**
 * Sanitizes one Provider event and derives device-code expiry without retaining secrets.
 */
export function sanitizeProviderAuthEvent(
  event: PiProviderAuthEvent,
  seq: number,
  now: number
): AuthSessionEventDto {
  switch (event.type) {
    case 'info':
      return {
        seq,
        type: event.type,
        message: boundedText(event.message),
        ...(event.links === undefined
          ? {}
          : {
              links: event.links.slice(0, MAX_SELECT_OPTIONS).map((link) => ({
                url: boundedText(link.url),
                ...(link.label === undefined ? {} : { label: boundedText(link.label) }),
              })),
            }),
      };
    case 'auth_url':
      return {
        seq,
        type: event.type,
        url: boundedText(event.url),
        ...(event.instructions === undefined ? {} : { instructions: boundedText(event.instructions) }),
      };
    case 'device_code':
      return {
        seq,
        type: event.type,
        userCode: boundedText(event.userCode),
        verificationUri: boundedText(event.verificationUri),
        ...(event.intervalSeconds === undefined ? {} : { intervalSeconds: event.intervalSeconds }),
        ...(event.expiresInSeconds === undefined
          ? {}
          : { expiresAt: new Date(now + event.expiresInSeconds * 1_000).toISOString() }),
      };
    case 'progress':
      return { seq, type: event.type, message: boundedText(event.message) };
  }
}

/**
 * Bounds the retained event list to the documented process-memory limit.
 */
export function trimProviderAuthEvents(events: AuthSessionEventDto[]): void {
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }
}

/**
 * Bounds untrusted Provider display text.
 */
function boundedText(value: string): string {
  return value.slice(0, MAX_TEXT_LENGTH);
}

/**
 * Advances one observable revision without allowing listeners to interrupt credential handling.
 */
export function touchProviderAuthSession(record: ProviderAuthSessionRecord): void {
  record.revision += 1;
  try {
    record.onChanged?.();
  } catch {
    /* Reconnect reads the current snapshot. */
  }
}
