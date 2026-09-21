/**
 * @author Codex
 * @description Owns the browser WebSocket connection, subscriptions, and connection state.
 */

import { v4 as uuidv4 } from 'uuid';
import { createRealtimeUrl } from './common.js';
import type {
  ClientRealtimeMessage,
  ServerRealtimeMessage,
  SessionRuntimeDto,
} from '@octopus/shared/protocol';

export const MAX_REALTIME_RECONNECT_ATTEMPTS = 5;

export type RealtimeConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'failed';

export class RealtimeClient {
  readonly #url = createRealtimeUrl();
  readonly #listeners = new Set<(message: ServerRealtimeMessage) => void>();
  readonly #stateListeners = new Set<() => void>();
  readonly #subscriptions = new Set<string>();
  readonly #confirmedSubscriptions = new Map<string, SessionRuntimeDto>();
  readonly #refreshing = new Map<string, { requestId: string; phase: 'unsubscribe' | 'subscribe' }>();
  #focusedSessionId: string | null = null;
  #sentFocus: string | null | undefined;
  #socket: WebSocket | undefined;
  #reconnectTimer: number | undefined;
  #closed = false;
  #attempt = 0;
  #state: RealtimeConnectionState = 'offline';

  /**
   * Establishes or reuses the tab-scoped realtime connection.
   */
  public connect(): void {
    if (this.#socket?.readyState === WebSocket.OPEN || this.#socket?.readyState === WebSocket.CONNECTING) {
      return;
    }
    if (this.#attempt >= MAX_REALTIME_RECONNECT_ATTEMPTS && this.#state === 'failed') {
      return;
    }
    this.#closed = false;
    this.#setState(this.#attempt === 0 ? 'connecting' : 'reconnecting');
    const socket = new WebSocket(this.#url);
    this.#socket = socket;
    socket.addEventListener('open', () => {
      this.#setState('connected');
      for (const sessionId of this.#subscriptions) {
        this.#sendRaw({ type: 'session.subscribe', requestId: uuidv4(), sessionId });
      }
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as ServerRealtimeMessage;
      this.#attempt = 0;
      if (this.#applySubscriptionMessage(message) === false) {
        return;
      }
      for (const listener of this.#listeners) {
        listener(message);
      }
    });
    socket.addEventListener('close', (event) => {
      if (this.#socket === socket) {
        this.#socket = undefined;
      }
      this.#sentFocus = undefined;
      this.#clearConfirmedSubscriptions();
      if (this.#closed) {
        this.#setState('offline');
        return;
      }
      if (event.code === 1008) {
        this.#attempt = MAX_REALTIME_RECONNECT_ATTEMPTS;
        this.#setState('failed');
        return;
      }
      this.#scheduleReconnect();
    });
    socket.addEventListener('error', () => socket.close());
  }

  /**
   * Retains Session subscriptions across route changes and reconnects.
   */
  public subscribeSession(sessionId: string): void {
    if (this.#subscriptions.has(sessionId)) {
      return;
    }
    this.#subscriptions.add(sessionId);
    if (this.#socket?.readyState === WebSocket.OPEN) {
      this.#sendRaw({ type: 'session.subscribe', requestId: uuidv4(), sessionId });
    }
  }

  /**
   * Refreshes one retained subscription through an acknowledged unsubscribe/subscribe handshake.
   */
  public refreshSessionSubscription(sessionId: string): void {
    if (!this.#subscriptions.has(sessionId) || this.#refreshing.has(sessionId)) {
      return;
    }
    this.#confirmedSubscriptions.delete(sessionId);
    if (this.#socket?.readyState === WebSocket.OPEN) {
      const requestId = uuidv4();
      this.#refreshing.set(sessionId, { requestId, phase: 'unsubscribe' });
      this.#sendRaw({ type: 'session.unsubscribe', requestId, sessionId });
    }
    this.#syncFocus();
    this.#publishState();
  }

  /**
   * Detects a retained binding that needs reconciliation, ignoring older catalog responses.
   */
  public needsSubscriptionRefresh(sessionId: string, runtime: SessionRuntimeDto): boolean {
    if (!this.#subscriptions.has(sessionId) || this.#refreshing.has(sessionId)) {
      return false;
    }
    const current = this.#confirmedSubscriptions.get(sessionId);
    return (
      !current ||
      (current.epoch <= runtime.epoch &&
        (current.runtimeId !== runtime.runtimeId || current.epoch !== runtime.epoch))
    );
  }

  /**
   * Drops one Session subscription when its consumer leaves.
   */
  public unsubscribeSession(sessionId: string): void {
    if (this.#focusedSessionId === sessionId) {
      this.setFocusedSession(null);
    }
    const desired = this.#subscriptions.delete(sessionId);
    const confirmed = this.#confirmedSubscriptions.delete(sessionId);
    if (confirmed) {
      this.#publishState();
    }
    if (desired && this.#socket?.readyState === WebSocket.OPEN) {
      this.#sendRaw({ type: 'session.unsubscribe', requestId: uuidv4(), sessionId });
    }
  }

  /**
   * Retains the route's focus intent and publishes it only after subscription confirmation.
   */
  public setFocusedSession(sessionId: string | null): void {
    this.#focusedSessionId = sessionId;
    this.#syncFocus();
  }

  /**
   * Publishes the current focus without queueing stale route or offline updates.
   */
  #syncFocus(): void {
    if (this.#socket?.readyState !== WebSocket.OPEN) {
      return;
    }
    const sessionId =
      this.#focusedSessionId !== null && this.#confirmedSubscriptions.has(this.#focusedSessionId)
        ? this.#focusedSessionId
        : null;
    if (this.#sentFocus === sessionId) {
      return;
    }
    this.#sendRaw({ type: 'session.focus', requestId: uuidv4(), sessionId });
    this.#sentFocus = sessionId;
  }

  /**
   * Reports whether this tab currently retains a Session subscription.
   */
  public hasSessionSubscription(sessionId: string): boolean {
    return this.#subscriptions.has(sessionId);
  }

  /**
   * Returns the confirmed runtime reservation for one Session.
   */
  public getConfirmedSubscription(sessionId: string): SessionRuntimeDto | undefined {
    return this.#confirmedSubscriptions.get(sessionId);
  }

  /**
   * Sends a typed command only while the socket is ready.
   */
  public send(message: ClientRealtimeMessage): void {
    if (this.#socket?.readyState !== WebSocket.OPEN) {
      throw new Error('Realtime connection is offline.');
    }
    this.#sendRaw(message);
  }

  /**
   * Registers a normalized server-message observer.
   */
  public onMessage(listener: (message: ServerRealtimeMessage) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Registers a React external-store observer for connection state.
   */
  public subscribeState(listener: () => void): () => void {
    this.#stateListeners.add(listener);
    return () => this.#stateListeners.delete(listener);
  }

  /**
   * Returns the current connection state snapshot.
   */
  public getState(): RealtimeConnectionState {
    return this.#state;
  }

  /**
   * Permanently closes the socket during application teardown.
   */
  public disconnect(): void {
    this.#closed = true;
    if (this.#reconnectTimer !== undefined) {
      window.clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = undefined;
    }
    this.#socket?.close(1000, 'Client closed');
    this.#socket = undefined;
    this.#sentFocus = undefined;
    this.#clearConfirmedSubscriptions();
    this.#attempt = 0;
    this.#setState('offline');
  }

  /**
   * Schedules the next bounded reconnect attempt or publishes the terminal failure state.
   */
  #scheduleReconnect(): void {
    if (this.#attempt >= MAX_REALTIME_RECONNECT_ATTEMPTS) {
      this.#setState('failed');
      return;
    }

    this.#setState('offline');
    const delay = Math.min(15_000, 500 * 2 ** this.#attempt) * (0.8 + Math.random() * 0.4);
    this.#attempt += 1;
    this.#reconnectTimer = window.setTimeout(() => {
      this.#reconnectTimer = undefined;
      if (!this.#closed) {
        this.connect();
      }
    }, delay);
  }

  /**
   * Serializes a command onto the active socket.
   */
  #sendRaw(message: ClientRealtimeMessage): void {
    this.#socket?.send(JSON.stringify(message));
  }

  /**
   * Tracks subscription acknowledgements and closes stale subscribe/unsubscribe races.
   */
  #applySubscriptionMessage(message: ServerRealtimeMessage): void | false {
    if (message.type === 'error' && message.requestId) {
      for (const [sessionId, refresh] of this.#refreshing) {
        if (refresh.requestId === message.requestId) {
          this.#refreshing.delete(sessionId);
        }
      }
    }
    if (message.type === 'session.subscribed') {
      const refresh = this.#refreshing.get(message.sessionId);
      if (refresh && (refresh.phase !== 'subscribe' || refresh.requestId !== message.requestId)) {
        return false;
      }
      this.#refreshing.delete(message.sessionId);
      if (!this.#subscriptions.has(message.sessionId)) {
        this.#sendRaw({ type: 'session.unsubscribe', requestId: uuidv4(), sessionId: message.sessionId });
        return false;
      }
      if (message.runtime !== undefined) {
        this.#confirmedSubscriptions.set(message.sessionId, message.runtime);
        this.#syncFocus();
        this.#publishState();
      }
      return;
    }
    if (message.type === 'session.unsubscribed') {
      const refresh = this.#refreshing.get(message.sessionId);
      if (refresh && (refresh.phase !== 'unsubscribe' || refresh.requestId !== message.requestId)) {
        return false;
      }
      const changed = this.#confirmedSubscriptions.delete(message.sessionId);
      this.#syncFocus();
      if (changed) {
        this.#publishState();
      }
      if (this.#subscriptions.has(message.sessionId)) {
        const requestId = uuidv4();
        if (refresh) {
          this.#refreshing.set(message.sessionId, { requestId, phase: 'subscribe' });
        }
        this.#sendRaw({ type: 'session.subscribe', requestId, sessionId: message.sessionId });
      } else {
        this.#refreshing.delete(message.sessionId);
      }
    }
  }

  /**
   * Clears transport acknowledgements while retaining desired subscriptions for reconnect.
   */
  #clearConfirmedSubscriptions(): void {
    this.#refreshing.clear();
    if (this.#confirmedSubscriptions.size === 0) {
      return;
    }
    this.#confirmedSubscriptions.clear();
    this.#publishState();
  }

  /**
   * Publishes connection state only when it changes.
   */
  #setState(state: RealtimeConnectionState): void {
    if (this.#state === state) {
      return;
    }
    this.#state = state;
    this.#publishState();
  }

  /**
   * Notifies React external-store consumers after connection or subscription changes.
   */
  #publishState(): void {
    for (const listener of this.#stateListeners) {
      listener();
    }
  }
}

export const realtimeClient = new RealtimeClient();
