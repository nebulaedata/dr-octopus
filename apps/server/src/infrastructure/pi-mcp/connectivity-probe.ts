/**
 * @author Codex
 * @description Probes effective MCP definitions through short-lived, bounded Server-owned client connections.
 */

import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import {
  Client,
  ReadBuffer,
  serializeMessage,
  SSEClientTransport,
  StreamableHTTPClientTransport,
  UnauthorizedError,
} from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import type { McpServerConnectivityDto, McpServerConnectivityStatus } from '@octopus/shared/protocol';
import type { JSONRPCMessage, Transport } from '@modelcontextprotocol/client';
import type { PiMcpServerEntry } from './types.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_CONCURRENCY = 3;

export interface McpConnectivityProbeTarget {
  serverKey: string;
  entry: PiMcpServerEntry;
}

interface ProbeOutcome {
  status: McpServerConnectivityStatus;
  toolCount?: number;
}

type ProbeResult = McpServerConnectivityDto['servers'][number];

export interface McpConnectivityProbeOptions {
  cwd: string;
  agentDir?: string;
  cacheTtlMs?: number;
  concurrency?: number;
  now?: () => Date;
  probeServer?: (entry: PiMcpServerEntry, cwd: string, agentDir: string) => Promise<ProbeOutcome>;
}

/** Coordinates per-Server revision-scoped single-flight probes and a short result cache. */
export class McpConnectivityProbe {
  readonly #cwd: string;
  readonly #agentDir: string;
  readonly #cacheTtlMs: number;
  readonly #concurrency: number;
  readonly #now: () => Date;
  readonly #probeServer: NonNullable<McpConnectivityProbeOptions['probeServer']>;
  #cached = new Map<string, { expiresAt: number; result: ProbeResult }>();
  #inFlight = new Map<string, Promise<ProbeResult>>();

  /** Creates an isolated Host connectivity probe. */
  public constructor(options: McpConnectivityProbeOptions) {
    this.#cwd = options.cwd;
    this.#agentDir = options.agentDir ?? options.cwd;
    this.#cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.#concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    this.#now = options.now ?? (() => new Date());
    this.#probeServer = options.probeServer ?? probeMcpServer;
  }

  /** Probes the requested targets while reusing matching per-Server work. */
  public probe(
    revision: string,
    targets: readonly McpConnectivityProbeTarget[]
  ): Promise<McpServerConnectivityDto> {
    return this.#run(revision, targets, this.#now());
  }

  /** Runs bounded workers while preserving catalog order. */
  async #run(
    revision: string,
    targets: readonly McpConnectivityProbeTarget[],
    startedAt: Date
  ): Promise<McpServerConnectivityDto> {
    const servers: McpServerConnectivityDto['servers'] = targets.map((target) => ({
      serverKey: target.serverKey,
      status: 'failed',
    }));
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < targets.length) {
        const index = cursor;
        cursor += 1;
        const target = targets[index];
        if (target === undefined) {
          continue;
        }
        servers[index] = await this.#probeTarget(revision, target);
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.#concurrency, targets.length) }, () => worker()));
    return {
      revision,
      checkedAt: startedAt.toISOString(),
      servers,
    } satisfies McpServerConnectivityDto;
  }

  /** Probes or reuses one Server without coupling it to the rest of the catalog. */
  #probeTarget(revision: string, target: McpConnectivityProbeTarget): Promise<ProbeResult> {
    const cacheKey = `${revision}\0${target.serverKey}`;
    const now = this.#now().getTime();
    const cached = this.#cached.get(cacheKey);
    if (cached !== undefined && cached.expiresAt > now) {
      return Promise.resolve(cached.result);
    }
    const current = this.#inFlight.get(cacheKey);
    if (current !== undefined) {
      return current;
    }
    const operation = this.#runTarget(target)
      .then((result) => {
        this.#cached.set(cacheKey, {
          expiresAt: this.#now().getTime() + this.#cacheTtlMs,
          result,
        });
        return result;
      })
      .finally(() => this.#inFlight.delete(cacheKey));
    this.#inFlight.set(cacheKey, operation);
    return operation;
  }

  /** Isolates one transport failure into the public status contract. */
  async #runTarget(target: McpConnectivityProbeTarget): Promise<ProbeResult> {
    const outcome =
      target.entry.disabled === true
        ? ({ status: 'disabled' } as const)
        : await this.#probeServer(target.entry, this.#cwd, this.#agentDir).catch(() => ({
            status: 'failed' as const,
          }));
    return { serverKey: target.serverKey, ...outcome };
  }
}

/** Establishes one MCP session, reads the tool catalog, and always closes it. */
async function probeMcpServer(entry: PiMcpServerEntry, cwd: string, agentDir: string): Promise<ProbeOutcome> {
  const timeout = Math.min(
    typeof entry.requestTimeoutMs === 'number' && entry.requestTimeoutMs > 0
      ? entry.requestTimeoutMs
      : DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS
  );
  const signal = AbortSignal.timeout(timeout);
  if (typeof entry.url === 'string') {
    return probeHttp(entry, timeout, signal);
  }
  let transport: Transport;
  if (typeof entry.command === 'string') {
    transport = new StdioClientTransport({
      command: interpolate(entry.command),
      args: (entry.args ?? []).map(interpolate),
      cwd: resolveOptionalPath(entry.cwd, cwd),
      env: resolveEnvironment(entry.env, agentDir),
      stderr: 'pipe',
    });
  } else {
    if (typeof entry.socket === 'string') {
      transport = new UnixSocketProbeTransport(resolveRequiredPath(entry.socket, cwd));
    } else {
      transport = (() => {
        throw new Error('MCP probe requires exactly one supported transport.');
      })();
    }
  }
  return probeTransport(entry, transport, timeout, signal);
}

/** Tries the configured HTTP transport, including the adapter-compatible auto fallback. */
async function probeHttp(
  entry: PiMcpServerEntry,
  timeout: number,
  signal: AbortSignal
): Promise<ProbeOutcome> {
  const url = new URL(interpolate(entry.url!));
  const options = { requestInit: { headers: resolveHttpHeaders(entry) } };
  let transports: ((() => StreamableHTTPClientTransport) | (() => SSEClientTransport))[];
  if (entry.httpTransport === 'sse') {
    transports = [() => new SSEClientTransport(url, options)];
  } else {
    if (entry.httpTransport === 'streamable-http') {
      transports = [() => new StreamableHTTPClientTransport(url, options)];
    } else {
      transports = [
        () => new StreamableHTTPClientTransport(url, options),
        () => new SSEClientTransport(url, options),
      ];
    }
  }
  let needsAuth = false;
  for (const createTransport of transports) {
    try {
      return await probeTransport(entry, createTransport(), timeout, signal);
    } catch (error) {
      needsAuth ||= isAuthenticationError(error);
    }
  }
  return { status: needsAuth ? 'needs_auth' : 'failed' };
}

/** Connects and requests tools to verify initialization and capability traffic. */
async function probeTransport(
  entry: PiMcpServerEntry,
  transport: Transport,
  timeout: number,
  signal: AbortSignal
): Promise<ProbeOutcome> {
  const protocolVersion = entry.protocolVersion ?? 'legacy';
  const client = new Client(
    { name: 'dr-octopus-connectivity-probe', version: '1.0.0' },
    {
      versionNegotiation: {
        mode: protocolVersion === '2026-07-28' ? { pin: protocolVersion } : protocolVersion,
        probe: { timeoutMs: timeout, maxRetries: 0 },
      },
    }
  );
  try {
    await client.connect(transport, { signal, timeout, maxTotalTimeout: timeout });
    const tools = await client.listTools(undefined, { signal, timeout, maxTotalTimeout: timeout });
    return { status: 'connected', toolCount: tools.tools.length };
  } catch (error) {
    if (isAuthenticationError(error)) {
      return { status: 'needs_auth' };
    }
    throw error;
  } finally {
    await client.close().catch(() => undefined);
  }
}

/** Resolves static HTTP headers without exposing their values outside this module. */
function resolveHttpHeaders(entry: PiMcpServerEntry): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(entry.headers ?? {})) {
    headers.set(name, interpolate(value));
  }
  const bearerToken =
    entry.bearerToken ?? (entry.bearerTokenEnv === undefined ? undefined : process.env[entry.bearerTokenEnv]);
  if (bearerToken !== undefined && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${interpolate(bearerToken)}`);
  }
  return headers;
}

/** Builds the same inherited process environment shape used by stdio MCP servers. */
function resolveEnvironment(
  overrides: Record<string, string> | undefined,
  agentDir: string
): Record<string, string> {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
  for (const [name, value] of Object.entries(overrides ?? {})) {
    environment[name] = interpolate(value);
  }
  const inheritedPath = Object.entries(environment).find(
    ([name]) => name.toLocaleLowerCase() === 'path'
  )?.[1];
  for (const name of Object.keys(environment)) {
    if (name.toLocaleLowerCase() === 'path') {
      delete environment[name];
    }
  }
  environment.PATH = [join(agentDir, 'npm', 'node_modules', '.bin'), join(agentDir, 'bin'), inheritedPath]
    .filter((value) => value !== undefined && value.length > 0)
    .join(delimiter);
  return environment;
}

/** Expands supported environment placeholders in adapter configuration values. */
function interpolate(value: string): string {
  return value
    .replace(/\$\{(\w+)\}/gu, (_match, name: string) => process.env[name] ?? '')
    .replace(/\$env:(\w+)/gu, (_match, name: string) => process.env[name] ?? '')
    .replace(/\{env:(\w+)\}/gu, (_match, name: string) => process.env[name] ?? '');
}

/** Resolves an optional adapter path against the Server probe working directory. */
function resolveOptionalPath(value: string | undefined, cwd: string): string | undefined {
  return value === undefined ? undefined : resolveRequiredPath(value, cwd);
}

/** Resolves environment variables, home aliases, and relative paths. */
function resolveRequiredPath(value: string, cwd: string): string {
  const expanded = interpolate(value);
  let homeExpanded: string;
  if (expanded === '~') {
    homeExpanded = homedir();
  } else {
    if (expanded.startsWith('~/')) {
      homeExpanded = resolve(homedir(), expanded.slice(2));
    } else {
      homeExpanded = expanded;
    }
  }
  return isAbsolute(homeExpanded) ? homeExpanded : resolve(cwd, homeExpanded);
}

/** Classifies authentication challenges without projecting raw remote errors. */
function isAuthenticationError(error: unknown): boolean {
  if (error instanceof UnauthorizedError) {
    return true;
  }
  const candidate = error as { status?: unknown; statusCode?: unknown; code?: unknown };
  return candidate?.status === 401 || candidate?.statusCode === 401 || candidate?.code === 401;
}

/** Implements MCP JSONL framing over a configured Unix-domain socket. */
class UnixSocketProbeTransport implements Transport {
  readonly #path: string;
  readonly #buffer = new ReadBuffer();
  #socket?: ReturnType<typeof createConnection>;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  /** Creates an unopened socket transport. */
  public constructor(path: string) {
    this.#path = path;
  }

  /** Opens the configured socket. */
  public async start(): Promise<void> {
    await new Promise<void>((resolveStart, reject) => {
      const socket = createConnection(this.#path);
      this.#socket = socket;
      socket.once('connect', resolveStart);
      socket.once('error', reject);
      socket.on('data', (chunk) => this.#receive(typeof chunk === 'string' ? Buffer.from(chunk) : chunk));
      socket.on('error', (error) => this.onerror?.(error));
      socket.on('close', () => {
        this.#socket = undefined;
        this.#buffer.clear();
        this.onclose?.();
      });
    });
  }

  /** Closes and reaps the socket. */
  public async close(): Promise<void> {
    const socket = this.#socket;
    this.#socket = undefined;
    this.#buffer.clear();
    if (socket === undefined || socket.destroyed) {
      return;
    }
    await new Promise<void>((resolveClose) => {
      socket.once('close', resolveClose);
      socket.end();
      setTimeout(() => socket.destroy(), 2_000).unref();
    });
  }

  /** Sends one framed JSON-RPC message. */
  public async send(message: JSONRPCMessage): Promise<void> {
    const socket = this.#socket;
    if (socket === undefined || socket.destroyed) {
      throw new Error('MCP socket is not connected.');
    }
    await new Promise<void>((resolveSend, reject) =>
      socket.write(serializeMessage(message), (error) => (error ? reject(error) : resolveSend()))
    );
  }

  /** Parses all complete JSONL frames currently buffered. */
  #receive(chunk: Buffer): void {
    try {
      this.#buffer.append(chunk);
      for (let message = this.#buffer.readMessage(); message !== null; message = this.#buffer.readMessage()) {
        this.onmessage?.(message);
      }
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.onerror?.(failure);
      void this.close();
    }
  }
}
