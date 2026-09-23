/**
 * @author Codex
 * @description Owns Provider authentication use cases and their bounded interactive sessions.
 */
import { randomUUID } from 'node:crypto';
import { ApplicationError } from '../../infrastructure/errors/application-error.js';
import { PiCredentialSynchronizationError } from '../../infrastructure/pi-settings/index.js';
import type {
  AuthSessionEventDto,
  AuthSessionPromptDto,
  ModelProviderAuthMethod,
  ProviderAuthResetResultDto,
  ProviderAuthSessionDto,
  ProviderAuthSessionStatus,
} from '@octopus/shared/protocol';
import type {
  PiProviderAuthEvent,
  PiProviderAuthPrompt,
  ServerPiSettingsStore,
} from '../../infrastructure/pi-settings/index.js';
import type { ModelConfigChanges, SettingsService } from '../model-settings/index.js';

const PROVIDER_AUTH_RESET_TIMEOUT_MS = 15_000;
export class ProviderAuthService {
  readonly #authSessions: ProviderAuthSessionManager;
  /**
   * Shares the model identity authority and the existing Pi settings resource.
   */
  constructor(
    private readonly models: SettingsService,
    private readonly piSettings: ServerPiSettingsStore,
    private readonly modelConfigChanges?: ModelConfigChanges,
    onAuthChanged?: () => void
  ) {
    this.#authSessions = new ProviderAuthSessionManager(piSettings, {
      modelConfigChanges,
      onChanged: onAuthChanged,
    });
  }

  /**
   * Starts a Provider-owned API Key or OAuth authentication session.
   *
   * @param providerKey Opaque Provider route identity.
   * @param authType Authentication method selected by the user.
   * @returns Initial non-secret session snapshot.
   */
  public async createProviderAuthSession(
    providerKey: string,
    authType: ModelProviderAuthMethod
  ): Promise<ProviderAuthSessionDto> {
    const provider = await this.models.requireProvider(providerKey);
    if (!provider.auth.methods.includes(authType)) {
      throw new ApplicationError(
        'MODEL_PROVIDER_CAPABILITY_UNSUPPORTED',
        'The selected authentication method is not supported by this Provider.',
        { statusCode: 422 }
      );
    }
    return this.#authSessions.create(providerKey, provider.id, authType);
  }

  /**
   * Reads one route-bound Provider authentication session.
   *
   * @param providerKey Opaque Provider route identity.
   * @param authSessionId Opaque authentication session identity.
   * @returns Current non-secret snapshot.
   */
  public getProviderAuthSession(providerKey: string, authSessionId: string): ProviderAuthSessionDto {
    return this.#authSessions.get(providerKey, authSessionId);
  }

  /**
   * Submits one write-only answer to the active Provider prompt.
   *
   * @param providerKey Opaque Provider route identity.
   * @param authSessionId Opaque authentication session identity.
   * @param promptId Opaque prompt identity.
   * @param answer Write-only user input.
   * @returns Snapshot after accepting the answer.
   */
  public answerProviderAuthPrompt(
    providerKey: string,
    authSessionId: string,
    promptId: string,
    answer: string
  ): ProviderAuthSessionDto {
    return this.#authSessions.answer(providerKey, authSessionId, promptId, answer);
  }

  /**
   * Cancels one active Provider authentication session.
   *
   * @param providerKey Opaque Provider route identity.
   * @param authSessionId Opaque authentication session identity.
   * @returns Updated snapshot, or undefined when already terminal.
   */
  public cancelProviderAuthSession(
    providerKey: string,
    authSessionId: string
  ): ProviderAuthSessionDto | undefined {
    return this.#authSessions.cancel(providerKey, authSessionId);
  }

  /**
   * Deletes the stored credential for one Provider and refreshes its runtime snapshot.
   *
   * @param providerKey Opaque Provider route identity.
   * @returns Credential deletion and snapshot synchronization outcome.
   */
  public async resetProviderAuth(providerKey: string): Promise<ProviderAuthResetResultDto> {
    const provider = await this.models.requireProvider(providerKey);
    if (!provider.auth.configured) {
      throw new ApplicationError(
        'MODEL_PROVIDER_AUTH_NOT_CONFIGURED',
        'This Provider does not have an active credential to reset.',
        { statusCode: 409 }
      );
    }
    if (provider.auth.source !== 'stored') {
      throw new ApplicationError(
        'MODEL_PROVIDER_AUTH_RESET_UNSUPPORTED',
        'Only credentials stored by this application can be reset here.',
        { statusCode: 422 }
      );
    }
    this.#authSessions.assertProviderIdle(provider.id);
    try {
      await this.piSettings.logoutProvider(provider.id, AbortSignal.timeout(PROVIDER_AUTH_RESET_TIMEOUT_MS));
      this.modelConfigChanges?.recordCommitted();
      return {
        credentialRemoved: true,
        providerSnapshotSynchronized: true,
        nextAction: 'none',
      };
    } catch (error) {
      if (error instanceof PiCredentialSynchronizationError && error.operation === 'logout') {
        this.modelConfigChanges?.recordCommitted();
        return {
          credentialRemoved: true,
          providerSnapshotSynchronized: false,
          nextAction: 'refresh_provider',
        };
      }
      const timedOut =
        error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
      throw new ApplicationError(
        'MODEL_PROVIDER_AUTH_RESET_FAILED',
        timedOut
          ? 'Resetting the Provider credential timed out.'
          : 'The Provider credential could not be reset.',
        { statusCode: timedOut ? 504 : 502, retryable: true, cause: error }
      );
    }
  }

  /**
   * Releases active authentication sessions during Server shutdown.
   */
  public close(): Promise<void> {
    return this.#authSessions.close();
  }
}

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
    private readonly settings: ServerPiSettingsStore,
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
              links: event.links.slice(0, MAX_SELECT_OPTIONS).map((link) => {
                const value = { url: boundedText(link.url) };
                if (link.label === undefined) {
                  return value;
                }
                return { ...value, label: boundedText(link.label) };
              }),
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
  if (!isActiveRecord(record) || record.currentPrompt !== undefined) {
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
      if (isActiveRecord(record)) {
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
  if (!isActiveRecord(record)) {
    return;
  }
  record.events.push(sanitizeProviderAuthEvent(event, (record.events.at(-1)?.seq ?? 0) + 1, now));
  trimProviderAuthEvents(record.events);
  touchProviderAuthSession(record);
}

/**
 * Identifies a record that still accepts Pi interaction updates.
 */
function isActiveRecord(record: ProviderAuthSessionRecord): boolean {
  return record.status === 'running' || record.status === 'awaiting_input';
}
