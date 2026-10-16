/**
 * @author Codex
 * @description Owns authenticated browser connection leases and bounded finite Browser requests over HTTP long polling.
 */
import { browserCommandSchema, browserResultSchema } from '@octopus/shared/protocol/browser-tools';
import type { BrowserMethod, BrowserCommand } from '@octopus/shared/protocol/browser-tools';
import { BasicToolError } from '../basic/basic-inputs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { isBrowserOriginAllowed } from '../../../build/browser-identity';
import { bridgeFrameLimit, bridgeHelloSchema, bridgeVersion } from '@octopus/shared/protocol/browser-bridge';
import type { BrowserBridgeSnapshot } from '@octopus/shared/protocol/browser-bridge';
import type { BridgeBootstrap } from './bridge-store';
import type { BridgeStore } from './bridge-store';

type Connection = BrowserBridgeSnapshot['connections'][number] & { polling: boolean };
export class BrowserBridge {
  private bootstrap: BridgeBootstrap | null = null;
  private closed = false;
  private connections = new Map<string, Connection>();
  private polls = new Map<string, () => void>();
  private pending = new Map<
    string,
    {
      command: BrowserCommand;
      sent: boolean;
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private inflight = 0;
  private buffered = 0;
  private readonly timer: ReturnType<typeof setInterval>;
  /**
   * Creates one connection authority with finite leases independent of Renderer lifetime.
   */
  constructor(private readonly store: BridgeStore) {
    this.timer = setInterval(() => {
      for (const connection of this.connections.values()) {
        if (connection.state === 'connected' && Date.now() - Date.parse(connection.lastSeen) > 25000) {
          connection.state = 'disconnected';
          this.failConnection(connection.connectionId);
        }
      }
    }, 1000);
    this.timer.unref();
  }
  /**
   * Sends one finite command to an explicit live installation; dispatched uncertainty is never replayed.
   */
  call(connectionId: string, method: BrowserMethod, params: unknown, taskId?: string): Promise<unknown> {
    return this.dispatch(
      browserCommandSchema.parse({
        type: 'request',
        requestId: randomUUID(),
        connectionId,
        taskId,
        method,
        params,
      })
    );
  }
  /**
   * Ends only the native page feedback belonging to this task, without closing tabs or replaying actions.
   */
  release(connectionId: string, taskId: string): Promise<unknown> {
    return this.dispatch(
      browserCommandSchema.parse({
        type: 'release',
        requestId: randomUUID(),
        connectionId,
        taskId,
      })
    );
  }
  /**
   * Queues one validated tool or task cleanup message on its authenticated connection.
   */
  private dispatch(command: BrowserCommand): Promise<unknown> {
    const { connectionId } = command;
    const connection = [...this.connections.values()].find(
      (item) => item.connectionId === connectionId && item.state === 'connected' && item.toolsAvailable
    );
    if (this.closed || !this.bootstrap?.enabled || !connection) {
      return Promise.reject(new BasicToolError('BROWSER_OFFLINE', 'The selected browser is unavailable.'));
    }
    if (this.pending.size >= 16) {
      return Promise.reject(new BasicToolError('BROWSER_BUSY', 'Browser request capacity is exhausted.'));
    }
    if (Buffer.byteLength(JSON.stringify(command)) > bridgeFrameLimit) {
      return Promise.reject(
        new BasicToolError('PAYLOAD_TOO_LARGE', 'Browser request exceeds the frame limit.')
      );
    }
    return new Promise((resolve, reject) => {
      const item = {
        command,
        sent: false,
        resolve,
        reject,
        timer: setTimeout(() => this.fail(command.requestId), 15000),
      };
      this.pending.set(command.requestId, item);
      this.polls.get(connectionId)?.();
    });
  }
  /**
   * Rejects one pending call according to whether it actually left Runtime.
   */
  private fail(requestId: string): void {
    const item = this.pending.get(requestId);
    if (!item) {
      return;
    }
    clearTimeout(item.timer);
    this.pending.delete(requestId);
    item.reject(
      new BasicToolError(
        item.sent ? 'OUTCOME_UNKNOWN' : 'BROWSER_OFFLINE',
        item.sent
          ? 'The browser outcome is unknown; do not replay the action.'
          : 'No browser command was dispatched.'
      )
    );
  }
  /**
   * Invalidates pending replies when a connection is replaced or actually disconnects.
   */
  private failConnection(id: string): void {
    for (const [requestId, item] of this.pending) {
      if (item.command.connectionId === id) {
        this.fail(requestId);
      }
    }
  }
  /**
   * Writes a new login-bound credential after the owned HTTP listener is known.
   */
  async initialize(endpoint: string): Promise<void> {
    this.bootstrap = await this.store.save(
      endpoint.replace(/\/mcp$/, '/browser-bridge'),
      this.store.enabled()
    );
  }
  /**
   * Persists explicit user consent and invalidates every previous connection and credential.
   */
  async setEnabled(enabled: boolean): Promise<void> {
    if (!this.bootstrap || this.closed) {
      throw new Error('Bridge unavailable');
    }
    if (enabled === this.bootstrap.enabled) {
      return;
    }
    this.bootstrap = await this.store.save(this.bootstrap.endpoint, enabled);
    for (const connection of this.connections.values()) {
      connection.state = 'disconnected';
      this.failConnection(connection.connectionId);
    }
    for (const finish of this.polls.values()) {
      finish();
    }
  }
  /**
   * Returns credential-free connection evidence; disconnected records are bounded to sixteen installations.
   */
  snapshot(): BrowserBridgeSnapshot {
    return {
      enabled: this.bootstrap?.enabled ?? false,
      connections: [...this.connections.values()].map(({ polling, ...value }) => {
        void polling;
        return value;
      }),
    };
  }
  /**
   * Ends only owned polls and leases; no browser action is claimed to have stopped.
   */
  close(): void {
    this.closed = true;
    clearInterval(this.timer);
    for (const connection of this.connections.values()) {
      connection.state = 'disconnected';
      this.failConnection(connection.connectionId);
    }
    for (const finish of this.polls.values()) {
      finish();
    }
  }
  /**
   * Authenticates before parsing, and admits only versioned handshake, finite results, polling and disconnect operations.
   */
  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (this.closed || !this.bootstrap) {
      this.send(response, 503, { error: 'RUNTIME_OFFLINE' });
      return;
    }
    const credential = request.headers.authorization;
    const admitted = this.bootstrap;
    const expected = `Bearer ${this.bootstrap.credential}`;
    if (
      typeof credential !== 'string' ||
      Buffer.byteLength(credential) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(credential), Buffer.from(expected))
    ) {
      this.send(response, 401, { error: 'UNAUTHORIZED' });
      return;
    }
    if (
      request.headers['x-octopus-role'] !== 'native-browser-host' ||
      !isBrowserOriginAllowed(request.headers['x-octopus-origin']) ||
      request.headers['x-octopus-login'] !== this.bootstrap.loginIdentity
    ) {
      this.send(response, 403, { error: 'FORBIDDEN_ROLE' });
      return;
    }
    if (!this.bootstrap.enabled) {
      this.send(response, 403, { error: 'DISABLED' });
      return;
    }
    if (this.inflight >= 24) {
      this.send(response, 429, { error: 'BRIDGE_BUSY' });
      return;
    }
    this.inflight++;
    try {
      if (request.method === 'POST') {
        if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
          this.send(response, 415, { error: 'INVALID_MESSAGE' });
          return;
        }
        const body = await this.readBody(request);
        const result = browserResultSchema.safeParse(body);
        if (result.success) {
          const id = z.uuid().parse(request.headers['x-octopus-connection']);
          const active = [...this.connections.values()].find(
            (item) => item.connectionId === id && item.state === 'connected'
          );
          const pending = this.pending.get(result.data.requestId);
          if (
            !active ||
            result.data.connectionId !== id ||
            !pending ||
            !pending.sent ||
            pending.command.connectionId !== id ||
            this.bootstrap !== admitted
          ) {
            this.send(response, 410, { error: 'SESSION_EXPIRED' });
            return;
          }
          clearTimeout(pending.timer);
          this.pending.delete(result.data.requestId);
          active.lastSeen = new Date().toISOString();
          if (result.data.error) {
            pending.reject(
              new BasicToolError(result.data.error, 'The selected browser could not complete this call.')
            );
          } else {
            pending.resolve(result.data.result);
          }
          this.send(response, 200, { accepted: true });
          return;
        }
        const hello = bridgeHelloSchema.parse(body);
        if (this.closed || this.bootstrap !== admitted || !this.bootstrap.enabled) {
          this.send(response, 410, { error: 'SESSION_EXPIRED' });
          return;
        }
        if (this.connections.size >= 16 && !this.connections.has(hello.installationId)) {
          const inactive = [...this.connections.values()].find((item) => item.state !== 'connected');
          if (!inactive) {
            this.send(response, 429, { error: 'BRIDGE_BUSY' });
            return;
          }
          this.connections.delete(inactive.installationId);
        }
        const previous = this.connections.get(hello.installationId);
        if (previous) {
          previous.state = 'disconnected';
          this.failConnection(previous.connectionId);
          this.polls.get(previous.connectionId)?.();
        }
        const connection: Connection = {
          installationId: hello.installationId,
          browser: hello.browser,
          extensionVersion: hello.extensionVersion,
          connectionId: randomUUID(),
          state: hello.version === bridgeVersion ? 'connected' : 'incompatible',
          lastSeen: new Date().toISOString(),
          polling: false,
          toolsAvailable: hello.version === bridgeVersion && hello.tools === true,
        };
        this.connections.set(connection.installationId, connection);
        this.send(
          response,
          hello.version === bridgeVersion ? 200 : 409,
          hello.version === bridgeVersion
            ? {
                type: 'connected',
                requestId: hello.requestId,
                version: bridgeVersion,
                connectionId: connection.connectionId,
              }
            : { type: 'error', requestId: hello.requestId, code: 'VERSION_INCOMPATIBLE' }
        );
        return;
      }
      const id = z.uuid().parse(request.headers['x-octopus-connection']);
      const connection = [...this.connections.values()].find((item) => item.connectionId === id);
      if (!connection || connection.state !== 'connected') {
        this.send(response, 410, { error: 'SESSION_EXPIRED' });
        return;
      }
      if (request.method === 'DELETE') {
        connection.state = 'disconnected';
        this.failConnection(connection.connectionId);
        this.polls.get(id)?.();
        this.send(response, 200, { disconnected: true });
        return;
      }
      if (request.method !== 'GET') {
        this.send(response, 405, { error: 'INVALID_MESSAGE' });
        return;
      }
      const requestId = z.uuid().parse(request.headers['x-octopus-request']);
      if (connection.polling) {
        this.send(response, 429, { error: 'BRIDGE_BUSY' });
        return;
      }
      connection.polling = true;
      connection.lastSeen = new Date().toISOString();
      await new Promise<void>((resolve) => {
        /**
         * Releases this single poll on timeout, disconnect, credential rotation or Runtime shutdown.
         */
        const finish = () => {
          clearTimeout(timer);
          response.removeListener('close', disconnected);
          this.polls.delete(id);
          connection.polling = false;
          if (!response.destroyed) {
            if (connection.state === 'connected' && !this.closed) {
              connection.lastSeen = new Date().toISOString();
              const item = [...this.pending.values()].find(
                (item) => item.command.connectionId === id && !item.sent
              );
              if (item) {
                item.sent = true;
                this.send(response, 200, item.command);
              } else {
                this.send(response, 200, { type: 'heartbeat', requestId, connectionId: id });
              }
            } else {
              this.send(response, 410, { error: 'SESSION_EXPIRED' });
            }
          }
          resolve();
        };
        /**
         * Invalidates the lease when this Host's actual long poll connection disappears.
         */
        const disconnected = () => {
          connection.state = 'disconnected';
          this.failConnection(connection.connectionId);
          finish();
        };
        const timer = setTimeout(finish, 10000);
        this.polls.set(id, finish);
        response.once('close', disconnected);
        if ([...this.pending.values()].some((item) => item.command.connectionId === id && !item.sent)) {
          finish();
        }
      });
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        const oversized = error instanceof Error && error.message === 'PAYLOAD_TOO_LARGE';
        this.send(response, oversized ? 413 : 400, {
          error: oversized ? 'PAYLOAD_TOO_LARGE' : 'INVALID_MESSAGE',
        });
      }
    } finally {
      this.inflight--;
    }
  }
  /**
   * Caps aggregate buffers and serialized bytes before decoding untrusted JSON.
   */
  private async readBody(request: IncomingMessage): Promise<unknown> {
    const parts: Buffer[] = [];
    let bytes = 0;
    try {
      for await (const part of request) {
        const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
        bytes += chunk.length;
        this.buffered += chunk.length;
        if (bytes > bridgeFrameLimit || this.buffered > 1024 * 1024) {
          throw new Error('PAYLOAD_TOO_LARGE');
        }
        parts.push(chunk);
      }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts, bytes)));
    } finally {
      this.buffered -= bytes;
    }
  }
  /**
   * Emits bounded safe JSON without credentials, paths, stacks or executable payloads.
   */
  private send(response: ServerResponse, status: number, value: unknown): void {
    response.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(JSON.stringify(value));
  }
}
