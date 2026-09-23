/**
 * @author Codex
 * @description Owns browser Session subscription retention across views, commands, and background runtime work.
 */

import type {
  HostEventEnvelope,
  RuntimeProjectionState,
  ServerRealtimeMessage,
} from '@octopus/shared/protocol';

const DEFAULT_COMMAND_RETENTION_MS = 30 * 60_000;

export interface SessionSubscriptionAdapter {
  /**
   * Requests a confirmed transport subscription for one Session.
   */
  subscribeSession(sessionId: string): void;
  /**
   * Replaces a retained transport binding while preserving the registry's view ownership.
   */
  refreshSessionSubscription?(sessionId: string): void;
  /**
   * Releases the transport subscription for one Session.
   */
  unsubscribeSession(sessionId: string): void;
}

export interface SessionRuntimeRegistryOptions {
  commandRetentionMs?: number;
  onSessionIdle?: (sessionId: string) => void;
}

export interface FailedSessionCommand {
  requestId: string;
  sessionId: string;
  message: string;
}

interface PendingCommand {
  baselineSequence: number;
  sessionId: string;
  settleOnAck: boolean;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * Centralizes the invariant that navigation cannot release a Session while accepted work may still emit events.
 */
export class SessionRuntimeRegistry {
  readonly #activeViews = new Map<string, number>();
  readonly #backgroundRuntimes = new Set<string>();
  readonly #commands = new Map<string, PendingCommand>();
  readonly #commandsBySession = new Map<string, Set<string>>();
  readonly #adapter: SessionSubscriptionAdapter;
  readonly #commandRetentionMs: number;
  readonly #onSessionIdle: (sessionId: string) => void;

  /**
   * Creates a browser runtime registry around one tab-scoped subscription adapter.
   *
   * @param adapter Transport adapter that owns desired WebSocket subscriptions.
   * @param options Retention bounds and idle-store callback.
   */
  public constructor(adapter: SessionSubscriptionAdapter, options: SessionRuntimeRegistryOptions = {}) {
    this.#adapter = adapter;
    this.#commandRetentionMs = options.commandRetentionMs ?? DEFAULT_COMMAND_RETENTION_MS;
    this.#onSessionIdle = options.onSessionIdle ?? (() => undefined);
  }

  /**
   * Retains a Session for a mounted view and returns an idempotent release callback.
   *
   * @param sessionId Stable Web Session identity.
   * @returns Callback that releases only this view's retain reason.
   */
  public openView(sessionId: string): () => void {
    this.#activeViews.set(sessionId, (this.#activeViews.get(sessionId) ?? 0) + 1);
    this.#synchronizeSubscription(sessionId);
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      const remaining = (this.#activeViews.get(sessionId) ?? 1) - 1;
      if (remaining > 0) {
        this.#activeViews.set(sessionId, remaining);
      } else {
        this.#activeViews.delete(sessionId);
      }
      this.#synchronizeSubscription(sessionId);
    };
  }

  /**
   * Retains a Session before a command is sent so immediate navigation cannot drop its events.
   *
   * @param sessionId Stable Web Session identity.
   * @param requestId Idempotent command identity.
   * @param baselineSequence Last authoritative sequence observed before sending.
   * @returns Callback that cancels this retain reason when the transport rejects synchronously.
   */
  public retainCommand(
    sessionId: string,
    requestId: string,
    baselineSequence: number,
    settleOnAck = false
  ): () => void {
    const existing = this.#commands.get(requestId);
    if (existing !== undefined) {
      return () => this.#releaseCommand(requestId);
    }
    const timeout = setTimeout(() => this.#releaseCommand(requestId), this.#commandRetentionMs);
    this.#commands.set(requestId, { baselineSequence, sessionId, settleOnAck, timeout });
    const requestIds = this.#commandsBySession.get(sessionId) ?? new Set<string>();
    requestIds.add(requestId);
    this.#commandsBySession.set(sessionId, requestIds);
    this.#synchronizeSubscription(sessionId);
    return () => this.#releaseCommand(requestId);
  }

  /**
   * Adopts an authoritative runtime state from bootstrap or realtime projection.
   *
   * @param sessionId Stable Web Session identity.
   * @param state Server-published runtime state.
   */
  public adoptRuntimeState(sessionId: string, state: RuntimeProjectionState): void {
    if (isBackgroundRuntimeState(state)) {
      this.#backgroundRuntimes.add(sessionId);
    } else {
      this.#backgroundRuntimes.delete(sessionId);
    }
    this.#synchronizeSubscription(sessionId);
  }

  /**
   * Releases waits owned by an old process before adopting a new transport generation.
   */
  public refreshSessionSubscription(sessionId: string): void {
    this.#adapter.refreshSessionSubscription?.(sessionId);
    for (const requestId of [...(this.#commandsBySession.get(sessionId) ?? [])]) {
      this.#releaseCommand(requestId);
    }
  }

  /**
   * Applies protocol settlement messages and returns correlated command failures for UI rollback.
   *
   * @param message Server realtime message.
   * @returns Correlated failure when a retained command was rejected.
   */
  public observe(message: ServerRealtimeMessage): FailedSessionCommand | undefined {
    if (message.type === 'error' && message.requestId !== undefined) {
      const pending = this.#commands.get(message.requestId);
      if (pending === undefined) {
        return undefined;
      }
      this.#releaseCommand(message.requestId);
      return { requestId: message.requestId, sessionId: pending.sessionId, message: message.message };
    }
    if (message.type === 'command.ack') {
      const pending = this.#commands.get(message.requestId);
      if (
        pending &&
        (pending.settleOnAck || (message.completion !== undefined && message.sessionId === pending.sessionId))
      ) {
        this.#releaseCommand(message.requestId);
      }
      return undefined;
    }
    if (!isRuntimeStateMessage(message)) {
      return undefined;
    }
    this.adoptRuntimeState(message.sessionId, message.payload.state);
    if (!isBackgroundRuntimeState(message.payload.state)) {
      for (const requestId of this.#commandsBySession.get(message.sessionId) ?? []) {
        const pending = this.#commands.get(requestId);
        if (
          pending !== undefined &&
          pending.settleOnAck !== true &&
          message.sequence > pending.baselineSequence
        ) {
          this.#releaseCommand(requestId);
        }
      }
    }
    return undefined;
  }

  /**
   * Releases every timer and subscription retained by this registry.
   */
  public dispose(): void {
    const sessionIds = new Set([
      ...this.#activeViews.keys(),
      ...this.#backgroundRuntimes,
      ...this.#commandsBySession.keys(),
    ]);
    for (const pending of this.#commands.values()) {
      clearTimeout(pending.timeout);
    }
    this.#activeViews.clear();
    this.#backgroundRuntimes.clear();
    this.#commands.clear();
    this.#commandsBySession.clear();
    for (const sessionId of sessionIds) {
      this.#adapter.unsubscribeSession(sessionId);
      this.#onSessionIdle(sessionId);
    }
  }

  /**
   * Releases one pending-command retain reason and reconciles its Session subscription.
   */
  #releaseCommand(requestId: string): void {
    const pending = this.#commands.get(requestId);
    if (pending === undefined) {
      return;
    }
    clearTimeout(pending.timeout);
    this.#commands.delete(requestId);
    const requestIds = this.#commandsBySession.get(pending.sessionId);
    requestIds?.delete(requestId);
    if (requestIds?.size === 0) {
      this.#commandsBySession.delete(pending.sessionId);
    }
    this.#synchronizeSubscription(pending.sessionId);
  }

  /**
   * Projects all retain reasons onto one desired transport subscription.
   */
  #synchronizeSubscription(sessionId: string): void {
    const retained =
      (this.#activeViews.get(sessionId) ?? 0) > 0 ||
      this.#backgroundRuntimes.has(sessionId) ||
      (this.#commandsBySession.get(sessionId)?.size ?? 0) > 0;
    if (retained) {
      this.#adapter.subscribeSession(sessionId);
      return;
    }
    this.#adapter.unsubscribeSession(sessionId);
    this.#onSessionIdle(sessionId);
  }
}

/**
 * Identifies runtime states whose future events must survive route changes.
 */
function isBackgroundRuntimeState(state: RuntimeProjectionState): boolean {
  return state === 'starting' || state === 'running' || state === 'recovering' || state === 'stopping';
}

/**
 * Narrows a protocol message to an authoritative runtime-state event.
 */
function isRuntimeStateMessage(
  message: ServerRealtimeMessage
): message is HostEventEnvelope<{ state: RuntimeProjectionState }> {
  return (
    message.type === 'agent.state' &&
    typeof message.payload === 'object' &&
    message.payload !== null &&
    'state' in message.payload &&
    typeof message.payload.state === 'string' &&
    ['dormant', 'starting', 'idle', 'running', 'recovering', 'stopping', 'failed'].includes(
      message.payload.state
    )
  );
}
