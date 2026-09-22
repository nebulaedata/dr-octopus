/**
 * @author Codex
 * @description Owns bounded in-memory Provider authentication sessions and publishes Pi authentication changes through domain notifications.
 */

import { touchProviderAuthSession } from './provider-auth-session-model.js';
import { randomUUID } from 'node:crypto';
import { ApplicationError } from '../../lib/errors/application-error.js';
import { PiCredentialSynchronizationError } from '../../lib/pi-settings/index.js';
import { appendProviderAuthEvent, requestProviderAuthAnswer } from './provider-auth-interaction.js';
import { toProviderAuthSessionDto } from './provider-auth-session-model.js';
import type { PiSettingsStore } from '../../lib/pi-settings/index.js';
import type { ModelConfigChanges } from './model-config-changes.js';
import type { ProviderAuthSessionRecord } from './provider-auth-session-model.js';
import type {
  ModelProviderAuthMethod,
  ProviderAuthSessionDto,
  ProviderAuthSessionStatus,
} from '@octopus/shared/protocol';

export const PROVIDER_AUTH_ACTIVE_TTL_MS = 15 * 60_000;
export const PROVIDER_AUTH_TERMINAL_TTL_MS = 5 * 60_000;
const MAX_ANSWER_LENGTH = 65_536;
const MAX_ACCEPTED_PROMPT_IDS = 100;
const SHUTDOWN_DRAIN_TIMEOUT_MS = 5_000;

export interface ProviderAuthSessionManagerOptions {
  modelConfigChanges?: ModelConfigChanges;
  /**
   * Emits authentication state changes without transporting credentials.
   */
  onChanged?(): void;
  now?: () => number;
  createId?: () => string;
}

/**
 * Coordinates Provider-scoped login operations while keeping answers out of stored session state.
 */
export class ProviderAuthSessionManager {
  readonly #sessions = new Map<string, ProviderAuthSessionRecord>();
  readonly #activeByProvider = new Map<string, string>();
  readonly #now: () => number;
  readonly #createId: () => string;
  #cleanupTimer: NodeJS.Timeout | undefined;
  readonly #onChanged: () => void;
  readonly #modelConfigChanges: ModelConfigChanges | undefined;
  #closed = false;

  /**
   * Creates one manager around the Server-owned Pi settings port.
   *
   * @param settings Pi authentication boundary.
   * @param options Deterministic policy dependencies for tests.
   */
  public constructor(
    private readonly settings: PiSettingsStore,
    options: ProviderAuthSessionManagerOptions = {}
  ) {
    this.#now = options.now ?? Date.now;
    this.#modelConfigChanges = options.modelConfigChanges;
    this.#createId = options.createId ?? randomUUID;
    this.#onChanged = () => options.onChanged?.();
  }

  /**
   * Registers and starts one Provider authentication flow without waiting for completion.
   *
   * @param providerKey Public opaque Provider identity.
   * @param providerId Pi Provider identity.
   * @param authType Selected authentication method.
   * @returns Initial observable session snapshot.
   */
  public create(
    providerKey: string,
    providerId: string,
    authType: ModelProviderAuthMethod
  ): ProviderAuthSessionDto {
    if (this.#closed) {
      throw settingsError(
        'MODEL_PROVIDER_AUTH_FAILED',
        'Authentication is unavailable during shutdown.',
        503
      );
    }
    const activeId = this.#activeByProvider.get(providerId);
    if (activeId !== undefined) {
      const active = this.#sessions.get(activeId);
      if (active !== undefined && isActive(active.status)) {
        throw settingsError(
          'MODEL_PROVIDER_AUTH_SESSION_CONFLICT',
          'This Provider already has an active authentication session.',
          409
        );
      }
    }
    const now = this.#now();
    const record: ProviderAuthSessionRecord = {
      id: this.#createId(),
      onChanged: this.#onChanged,
      providerKey,
      providerId,
      authType,
      status: 'running',
      revision: 1,
      createdAt: now,
      expiresAt: now + PROVIDER_AUTH_ACTIVE_TTL_MS,
      abortController: new AbortController(),
      acceptedPromptIds: new Set(),
      events: [],
      task: Promise.resolve(),
    };
    this.#sessions.set(record.id, record);
    this.#activeByProvider.set(providerId, record.id);
    record.task = this.#run(record);
    this.#scheduleExpiry();
    return toProviderAuthSessionDto(record);
  }

  /**
   * Rejects mutations that would race an active login for the same Provider.
   *
   * @param providerId Pi Provider identity.
   */
  public assertProviderIdle(providerId: string): void {
    const activeId = this.#activeByProvider.get(providerId);
    const active = activeId === undefined ? undefined : this.#sessions.get(activeId);
    if (active !== undefined && isActive(active.status)) {
      throw settingsError(
        'MODEL_PROVIDER_AUTH_SESSION_CONFLICT',
        'This Provider already has an active authentication session.',
        409
      );
    }
  }

  /**
   * Reads a session only through its bound Provider identity.
   *
   * @param providerKey Public Provider identity from the route.
   * @param sessionId Opaque authentication session identity.
   * @returns Current non-secret snapshot.
   */
  public get(providerKey: string, sessionId: string): ProviderAuthSessionDto {
    const record = this.#require(providerKey, sessionId);
    if (record.status === 'expired') {
      throw settingsError(
        'MODEL_PROVIDER_AUTH_SESSION_EXPIRED',
        'The authentication session expired. Start a new session.',
        410
      );
    }
    return toProviderAuthSessionDto(record);
  }

  /**
   * Resolves the active Pi prompt exactly once without retaining the supplied answer.
   *
   * @param providerKey Public Provider identity from the route.
   * @param sessionId Opaque authentication session identity.
   * @param promptId Current opaque prompt identity.
   * @param answer Write-only answer supplied by the browser.
   * @returns Snapshot after the answer was accepted.
   */
  public answer(
    providerKey: string,
    sessionId: string,
    promptId: string,
    answer: string
  ): ProviderAuthSessionDto {
    const record = this.#require(providerKey, sessionId);
    if (record.acceptedPromptIds.has(promptId)) {
      return toProviderAuthSessionDto(record);
    }
    const pending = record.currentPrompt;
    if (record.status !== 'awaiting_input' || pending === undefined || pending.dto.id !== promptId) {
      throw settingsError(
        'MODEL_PROVIDER_AUTH_PROMPT_STALE',
        'The authentication prompt is no longer active.',
        409
      );
    }
    if (answer.length > MAX_ANSWER_LENGTH) {
      throw settingsError(
        'MODEL_PROVIDER_AUTH_ANSWER_INVALID',
        'The authentication answer is too long.',
        422
      );
    }
    if (pending.dto.type === 'select' && !pending.dto.options?.some((option) => option.id === answer)) {
      throw settingsError('MODEL_PROVIDER_AUTH_ANSWER_INVALID', 'Select one of the available options.', 422);
    }
    pending.settled = true;
    pending.detachAbort();
    record.currentPrompt = undefined;
    record.acceptedPromptIds.add(promptId);
    if (record.acceptedPromptIds.size > MAX_ACCEPTED_PROMPT_IDS) {
      const oldestPromptId = record.acceptedPromptIds.values().next().value;
      if (oldestPromptId !== undefined) {
        record.acceptedPromptIds.delete(oldestPromptId);
      }
    }
    record.status = 'running';
    touchProviderAuthSession(record);
    pending.resolve(answer);
    return toProviderAuthSessionDto(record);
  }

  /**
   * Cancels an active session while treating terminal cancellation as idempotent.
   *
   * @param providerKey Public Provider identity from the route.
   * @param sessionId Opaque authentication session identity.
   * @returns Updated snapshot, or undefined when the session was already terminal.
   */
  public cancel(providerKey: string, sessionId: string): ProviderAuthSessionDto | undefined {
    const record = this.#require(providerKey, sessionId);
    if (!isActive(record.status)) {
      return undefined;
    }
    this.#finish(record, 'cancelled');
    record.abortController.abort();
    this.#rejectPrompt(record, abortError());
    return toProviderAuthSessionDto(record);
  }

  /**
   * Stops new sessions, aborts active work, and waits for Pi tasks to settle.
   */
  public async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    clearTimeout(this.#cleanupTimer);
    for (const record of this.#sessions.values()) {
      if (isActive(record.status)) {
        this.#finish(record, 'cancelled');
        record.abortController.abort();
        this.#rejectPrompt(record, abortError());
      }
    }
    let drainTimeout: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.allSettled([...this.#sessions.values()].map((record) => record.task)),
      new Promise<void>((resolve) => {
        drainTimeout = setTimeout(resolve, SHUTDOWN_DRAIN_TIMEOUT_MS);
      }),
    ]);
    if (drainTimeout !== undefined) {
      clearTimeout(drainTimeout);
    }
    this.#sessions.clear();
    this.#activeByProvider.clear();
  }

  /**
   * Executes one Pi login and owns every terminal transition.
   */
  async #run(record: ProviderAuthSessionRecord): Promise<void> {
    try {
      await this.settings.loginProvider(record.providerId, record.authType, {
        signal: record.abortController.signal,
        prompt: (prompt) => requestProviderAuthAnswer(record, prompt, this.#createId),
        notify: (event) => appendProviderAuthEvent(record, event, this.#now()),
      });
      this.#modelConfigChanges?.recordCommitted();
      if (isActive(record.status)) {
        record.result = {
          credentialCommitted: true,
          providerSnapshotSynchronized: true,
          nextAction: 'none',
        };
        this.#finish(record, 'completed');
      }
    } catch (error) {
      if (error instanceof PiCredentialSynchronizationError) {
        this.#modelConfigChanges?.recordCommitted();
      }
      if (!isActive(record.status)) {
        return;
      }
      if (error instanceof PiCredentialSynchronizationError) {
        record.result = {
          credentialCommitted: true,
          providerSnapshotSynchronized: false,
          nextAction: 'refresh_provider',
        };
        this.#finish(record, 'committed_but_unsynced');
        return;
      }
      if (record.abortController.signal.aborted) {
        this.#finish(record, 'cancelled');
        return;
      }
      record.error = {
        code: 'MODEL_PROVIDER_AUTH_FAILED',
        message: 'The Provider rejected or could not complete authentication.',
        retryable: false,
      };
      this.#finish(record, 'failed');
    }
  }

  /**
   * Resolves a route-bound record or returns the same not-found shape for mismatches.
   */
  #require(providerKey: string, sessionId: string): ProviderAuthSessionRecord {
    const record = this.#sessions.get(sessionId);
    if (record === undefined || record.providerKey !== providerKey) {
      throw settingsError(
        'MODEL_PROVIDER_AUTH_SESSION_NOT_FOUND',
        'The authentication session does not exist.',
        404
      );
    }
    return record;
  }

  /**
   * Applies one terminal transition and releases Provider concurrency ownership.
   */
  #finish(record: ProviderAuthSessionRecord, status: ProviderAuthSessionStatus): void {
    record.status = status;
    touchProviderAuthSession(record);
    record.terminalExpiresAt = this.#now() + PROVIDER_AUTH_TERMINAL_TTL_MS;
    if (this.#activeByProvider.get(record.providerId) === record.id) {
      this.#activeByProvider.delete(record.providerId);
    }
    this.#rejectPrompt(record, abortError());
    this.#scheduleExpiry();
  }

  /**
   * Rejects and forgets a current prompt without retaining its prior answer.
   */
  #rejectPrompt(record: ProviderAuthSessionRecord, error: Error): void {
    const pending = record.currentPrompt;
    if (pending === undefined || pending.settled) {
      return;
    }
    pending.settled = true;
    pending.detachAbort();
    record.currentPrompt = undefined;
    pending.reject(error);
  }

  /**
   * Arms only the earliest actual expiry, rather than scanning active flows on a fixed interval.
   */
  #scheduleExpiry(): void {
    clearTimeout(this.#cleanupTimer);
    if (this.#closed) {
      return;
    }
    const deadlines = [...this.#sessions.values()].map((record) =>
      isActive(record.status) ? record.expiresAt : (record.terminalExpiresAt ?? Infinity)
    );
    const next = Math.min(...deadlines);
    if (Number.isFinite(next)) {
      this.#cleanupTimer = setTimeout(() => this.#cleanup(), Math.max(0, next - this.#now()));
      this.#cleanupTimer.unref();
    }
  }

  /**
   * Expires active sessions and purges terminal sessions on the shared cleanup tick.
   */
  #cleanup(): void {
    const now = this.#now();
    for (const [id, record] of this.#sessions) {
      if (isActive(record.status) && record.expiresAt <= now) {
        this.#finish(record, 'expired');
        record.abortController.abort();
      } else if (!isActive(record.status) && (record.terminalExpiresAt ?? Infinity) <= now) {
        this.#sessions.delete(id);
      }
    }
    this.#scheduleExpiry();
  }
}

/**
 * Identifies session states that still own Provider authentication work.
 */
function isActive(status: ProviderAuthSessionStatus): boolean {
  return status === 'running' || status === 'awaiting_input';
}

/**
 * Creates a transport-safe Settings application error.
 */
function settingsError(code: string, message: string, statusCode: number): ApplicationError {
  return new ApplicationError(code, message, { statusCode });
}

/**
 * Creates the standard cancellation error used to unwind Pi prompt promises.
 */
function abortError(): Error {
  return new DOMException('Authentication was cancelled.', 'AbortError');
}
