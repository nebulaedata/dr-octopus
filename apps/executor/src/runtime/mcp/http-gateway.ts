/**
 * @author Codex
 * @description Hosts bounded authenticated MCP sessions on loopback and an explicitly selected private network with shared task authority.
 * GET/POST/DELETE /mcp
 * POST /browser-bridge (loopback only)
 * GET/PUT /transfers/:transferId/content
 */
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BasicToolError } from '../basic/basic-inputs';
import type { TaskAuthority } from './task-authority';
import { createMcpServer } from './mcp-server';
import type { BrowserBridge } from '../browser/browser-bridge';
import { networkAddressSchema } from '../../contracts/connection-settings';

type Session = {
  clientId: string;
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  initialized: boolean;
  touched: number;
  requests: number;
  network: boolean;
};

export class HttpGateway {
  private readonly sessions = new Map<string, Session>();
  private readonly pending = new Set<Session>();
  private readonly http: HttpServer;
  private networkHttp: HttpServer | null = null;
  private networkHost: string | null = null;
  private readonly timer: ReturnType<typeof setInterval>;
  private requests = 0;
  private bufferedBytes = 0;
  private port = 0;
  private closing = false;

  /**
   * Creates a loopback-first HTTP owner with finite headers, buffers, requests and sessions shared across listeners.
   */
  constructor(
    private readonly authority: TaskAuthority,
    private readonly browser?: BrowserBridge
  ) {
    this.http = this.createListener(false);
    this.timer = setInterval(() => {
      void this.expire();
    }, 30000);
    this.timer.unref();
  }

  /**
   * Shares bounded admission and task authority; the network listener never admits bridge traffic.
   */
  private createListener(network: boolean): HttpServer {
    const http = createServer(
      { maxHeaderSize: 8192, requestTimeout: 1800000, headersTimeout: 10000 },
      (request, response) => {
        void this.handle(request, response, network).catch(() => {
          if (!response.headersSent) {
            this.reject(response, 500, 'MCP_REQUEST_FAILED');
          } else {
            response.destroy();
          }
        });
      }
    );
    http.maxConnections = 32;
    http.keepAliveTimeout = 5000;
    return http;
  }

  /**
   * Counts initialized protocol sessions by grant owner; this does not assert continuous network liveness.
   */
  connections(): { clientId: string; sessions: number }[] {
    const clients = new Map<string, number>();
    for (const session of this.sessions.values()) {
      if (session.initialized) {
        clients.set(session.clientId, (clients.get(session.clientId) ?? 0) + 1);
      }
    }
    return [...clients].map(([clientId, sessions]) => ({ clientId, sessions }));
  }

  /**
   * Reports actual owned listener state; no external address probe or authentication bypass is needed.
   */
  isListening(): boolean {
    return this.http.listening && (!this.networkHttp || this.networkHttp.listening) && !this.closing;
  }

  /**
   * Returns only an actually listening explicitly selected network endpoint.
   */
  remoteEndpoint(): string | null {
    return this.networkHttp?.listening && !this.closing ? `http://${this.networkHost}/mcp` : null;
  }

  /**
   * Binds the selected port without silent fallback; port zero is used only by trusted isolated test Hosts.
   */
  async listen(port: number, networkAddress: string | null = null): Promise<string> {
    if (networkAddress !== null) {
      networkAddressSchema.parse(networkAddress);
    }
    try {
      await this.bind(this.http, port, '127.0.0.1');
      const address = this.http.address();
      if (!address || typeof address === 'string') {
        throw new BasicToolError('MCP_LISTEN_FAILED', 'No local TCP endpoint was opened.');
      }
      this.port = address.port;
      if (networkAddress !== null) {
        this.networkHost = `${networkAddress}:${this.port}`;
        this.networkHttp = this.createListener(true);
        await this.bind(this.networkHttp, this.port, networkAddress);
      }
      return `http://127.0.0.1:${this.port}/mcp`;
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  /**
   * Binds exactly one address with no wildcard, alternate port or local-only fallback on failure.
   */
  private async bind(http: HttpServer, port: number, address: string): Promise<void> {
    await new Promise<void>((accept, reject) => {
      http.once('error', reject);
      http.listen(port, address, () => {
        http.removeListener('error', reject);
        accept();
      });
    }).catch((error: unknown) => {
      throw new BasicToolError(
        error instanceof Error && 'code' in error && error.code === 'EADDRINUSE'
          ? 'PORT_IN_USE'
          : 'MCP_LISTEN_FAILED',
        'The configured MCP endpoint could not be opened.'
      );
    });
  }

  /**
   * Closes one revoked owner's transports after its task has drained; a session ID is never a bearer credential.
   */
  async revoke(clientId: string): Promise<void> {
    for (const [id, session] of this.sessions) {
      if (session.clientId === clientId) {
        this.sessions.delete(id);
        await session.server.close();
      }
    }
  }

  /**
   * Stops network admission, drains tasks, then closes transports and every app-owned HTTP socket.
   */
  async close(): Promise<void> {
    if (this.closing) {
      return;
    }
    this.closing = true;
    this.browser?.close();
    clearInterval(this.timer);
    try {
      await this.authority.close();
    } finally {
      await Promise.allSettled(
        [...this.sessions.values(), ...this.pending].map((session) => session.server.close())
      );
      this.sessions.clear();
      this.pending.clear();
      for (const http of [this.http, this.networkHttp]) {
        http?.closeAllConnections();
        if (http?.listening) {
          await new Promise<void>((accept) => http.close(() => accept()));
        }
      }
    }
  }

  /**
   * Rejects foreign Host/Origin and network bridge traffic before buffering; every MCP request needs a grant.
   */
  private async handle(request: IncomingMessage, response: ServerResponse, network: boolean): Promise<void> {
    if (this.closing) {
      this.reject(response, 503, 'RUNTIME_STOPPING');
      return;
    }
    const transferRoute = /^\/transfers\/([0-9a-f-]{36})\/content$/.exec(request.url ?? '');
    if (!transferRoute && request.url !== '/mcp' && (network || request.url !== '/browser-bridge')) {
      this.reject(response, 404, 'NOT_FOUND');
      return;
    }
    const expectedHost = network ? this.networkHost : `127.0.0.1:${this.port}`;
    const defaultPortHost = this.port === 80 ? expectedHost?.split(':')[0] : null;
    if (
      (request.headers.host !== expectedHost && request.headers.host !== defaultPortHost) ||
      request.headers.origin !== undefined
    ) {
      this.reject(response, 403, 'FORBIDDEN_ORIGIN');
      return;
    }
    if (request.url === '/browser-bridge') {
      if (!this.browser) {
        this.reject(response, 404, 'NOT_FOUND');
        return;
      }
      await this.browser.handle(request, response);
      return;
    }
    if (transferRoute) {
      await this.transferBytes(transferRoute[1]!, request, response, 'http://' + expectedHost);
      return;
    }
    const credential = request.headers.authorization;
    let clientId: string;
    try {
      clientId = this.authority.authenticate(
        typeof credential === 'string' && credential.startsWith('Bearer ') ? credential.slice(7) : ''
      ).clientId;
    } catch {
      this.reject(response, 401, 'UNAUTHORIZED');
      return;
    }
    if (!['POST', 'GET', 'DELETE'].includes(request.method ?? '')) {
      this.reject(response, 405, 'METHOD_NOT_ALLOWED');
      return;
    }
    if (
      request.headers['mcp-protocol-version'] !== undefined &&
      request.headers['mcp-protocol-version'] !== '2025-11-25'
    ) {
      this.reject(response, 400, 'PROTOCOL_INCOMPATIBLE');
      return;
    }
    if (this.requests >= 16) {
      this.reject(response, 429, 'RUNTIME_BUSY');
      return;
    }
    this.requests++;
    let session: Session | undefined;
    let created = false;
    try {
      const id = request.headers['mcp-session-id'];
      if (id !== undefined) {
        if (
          typeof id !== 'string' ||
          !(session = this.sessions.get(id)) ||
          session.clientId !== clientId ||
          session.network !== network
        ) {
          this.reject(response, 404, 'SESSION_NOT_FOUND');
          return;
        }
      }
      if (request.method !== 'POST') {
        if (!session) {
          this.reject(response, 400, 'SESSION_REQUIRED');
          return;
        }
        session.touched = Date.now();
        session.requests++;
        try {
          if (request.method === 'DELETE') {
            const current = this.authority.taskStatus(clientId, {}).task;
            if (current) {
              await this.authority.stop(clientId, current.taskId);
            }
          }
          await session.transport.handleRequest(request, response);
        } finally {
          session.requests--;
        }
        return;
      }
      if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
        this.reject(response, 415, 'JSON_REQUIRED');
        return;
      }
      const body = await this.body(request);
      this.authority.requireGrant(clientId);
      if (isInitializeRequest(body)) {
        if (session || body.params.protocolVersion !== '2025-11-25') {
          this.reject(response, 400, 'PROTOCOL_INCOMPATIBLE');
          return;
        }
        if (
          this.sessions.size + this.pending.size >= 32 ||
          [...this.sessions.values(), ...this.pending].filter((item) => item.clientId === clientId).length >=
            4
        ) {
          this.reject(response, 429, 'SESSION_LIMIT');
          return;
        }
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          // Stream keep-alive comments while finite tools run; buffered JSON replies hit client HTTP idle limits.
          enableJsonResponse: false,
          keepAliveMs: 15000,
          onsessioninitialized: (newId) => {
            if (session) {
              this.sessions.set(newId, session);
            }
          },
          onsessionclosed: (closedId) => {
            this.sessions.delete(closedId);
          },
        });
        const server = createMcpServer(this.authority, clientId, 'http://' + expectedHost);
        session = {
          clientId,
          transport,
          server,
          initialized: false,
          touched: Date.now(),
          requests: 0,
          network,
        };
        const current = session;
        server.server.oninitialized = () => {
          current.initialized = true;
        };
        created = true;
        this.pending.add(session);
        await server.connect(transport);
      } else if (
        !session ||
        (!session.initialized &&
          !(
            typeof body === 'object' &&
            body !== null &&
            'method' in body &&
            body.method === 'notifications/initialized'
          ))
      ) {
        this.reject(response, 400, 'INITIALIZATION_REQUIRED');
        return;
      }
      session.touched = Date.now();
      session.requests++;
      try {
        await session.transport.handleRequest(request, response, body);
      } finally {
        session.requests--;
        this.pending.delete(session);
      }
    } catch (error) {
      if (!response.headersSent) {
        this.reject(
          response,
          error instanceof BasicToolError && error.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400,
          error instanceof BasicToolError ? error.code : 'INVALID_REQUEST'
        );
      }
    } finally {
      if (created && session) {
        this.pending.delete(session);
        if (!session.transport.sessionId) {
          await session.server.close();
        }
      }
      this.requests--;
    }
  }

  /**
   * Streams one complete file with temporary transfer credentials, without buffering bytes into MCP.
   */
  private async transferBytes(
    id: string,
    request: IncomingMessage,
    response: ServerResponse,
    origin: string
  ): Promise<void> {
    const transfers = this.authority.transfers;
    if (!transfers || this.requests >= 16) {
      this.reject(response, 429, 'TRANSFER_UNAVAILABLE');
      return;
    }
    this.requests++;
    try {
      const authorization = request.headers.authorization ?? '';
      const owner = transfers.authenticate(
        id,
        authorization.startsWith('Bearer ') ? authorization.slice(7) : '',
        origin,
        request.method ?? ''
      );
      request.setTimeout(30000, () => request.destroy());
      response.setTimeout(30000, () => response.destroy());
      const record = transfers.require(owner, id, true);
      if (request.method === 'GET') {
        if (record.status !== 'ready') {
          throw new BasicToolError('TRANSFER_NOT_READY', 'File is not ready.');
        }
        response.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': record.totalBytes,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'X-Transfer-Sha256': record.sha256!,
        });
        await transfers.download(owner, id, response);
        return;
      }
      const rawLength = request.headers['content-length'];
      if (
        typeof rawLength !== 'string' ||
        !/^\d{1,10}$/.test(rawLength) ||
        Number(rawLength) !== record.totalBytes
      ) {
        this.reject(response, 400, 'INVALID_LENGTH');
        return;
      }
      const result = await transfers.upload(owner, id, request, Number(rawLength));
      response.writeHead(result.status === 'completed' ? 200 : 409, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      response.end(JSON.stringify(result));
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
      } else {
        this.reject(
          response,
          error instanceof BasicToolError && error.code === 'UNAUTHORIZED' ? 401 : 409,
          error instanceof BasicToolError ? error.code : 'TRANSFER_FAILED'
        );
      }
    } finally {
      this.requests--;
    }
  }

  /**
   * Reads UTF-8 JSON under per-request and aggregate byte budgets before SDK parsing or tool admission.
   */
  private async body(request: IncomingMessage): Promise<unknown> {
    const limit = 24 * 1024 * 1024;
    const length = request.headers['content-length'];
    if (length && (!/^\d+$/.test(length) || Number(length) > limit)) {
      throw new BasicToolError('PAYLOAD_TOO_LARGE', 'The MCP body exceeds its byte budget.');
    }
    let bytes = 0;
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => request.destroy(), 10000);
    try {
      for await (const chunk of request) {
        const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += part.length;
        this.bufferedBytes += part.length;
        if (bytes > limit || this.bufferedBytes > 48 * 1024 * 1024) {
          throw new BasicToolError('PAYLOAD_TOO_LARGE', 'The MCP body exceeds its byte budget.');
        }
        chunks.push(part);
      }
      const value: unknown = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes))
      );
      const queue = [{ value, depth: 0 }];
      let nodes = 0;
      while (queue.length) {
        const item = queue.pop()!;
        if (++nodes > 10000 || item.depth > 32) {
          throw new BasicToolError('INVALID_REQUEST', 'MCP JSON nesting or node count exceeds its budget.');
        }
        if (item.value && typeof item.value === 'object') {
          for (const child of Object.values(item.value)) {
            queue.push({ value: child, depth: item.depth + 1 });
          }
        }
      }
      return value;
    } finally {
      clearTimeout(timer);
      this.bufferedBytes -= bytes;
    }
  }

  /**
   * Emits only stable safe transport errors; no stack, path, token or tool content is reflected.
   */
  private reject(response: ServerResponse, status: number, code: string): void {
    response.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(JSON.stringify({ error: code }));
  }

  /**
   * Reclaims idle transport sessions without replaying requests or renewing task lifetime.
   */
  private async expire(): Promise<void> {
    for (const [id, session] of this.sessions) {
      if (!session.requests && Date.now() - session.touched > 300000) {
        this.sessions.delete(id);
        await session.server.close().catch(() => {});
      }
    }
  }
}
