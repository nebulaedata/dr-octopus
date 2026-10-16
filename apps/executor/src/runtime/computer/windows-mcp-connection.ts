/**
 * @author Codex
 * @description Negotiates one Windows-MCP connection using an owned stdio or credential-bound loopback HTTP without exposing desktop actions.
 */
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { Transport, FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import { windowsMcpSelectionSchema } from '../../contracts/windows-mcp';
import type { WindowsMcpSelection, WindowsMcpStatus } from '../../contracts/windows-mcp';
import { z } from 'zod';
import { backendSchemas, captureFailureSchema, type BackendName } from './computer-inputs';
import { executorProduct } from '../../contracts/product';

export type OwnedWindowsMcp = {
  transport: Transport;
  /**
   * Confirms exit of this product's local backend and its owned process tree; rejection means unconfirmed cleanup.
   */
  stop: () => Promise<void>;
};

export type WindowsMcpDependencies = {
  /**
   * Opens the fixed product-local supervised profile, never a caller-provided command or user-managed backend.
   */
  openLocal?: () => Promise<OwnedWindowsMcp>;
  /**
   * Resolves one approved private credential inside the trusted Runtime; tokens never enter status DTOs.
   */
  readCredential?: (credentialId: string) => Promise<string>;
};

const responseLimit = 24 * 1024 * 1024;

/**
 * Compares structural JSON Schema while ignoring documentation supplied by a backend.
 */
function schemaKey(value: unknown): string {
  if (Array.isArray(value)) {
    return '[' + value.map(schemaKey).join(',') + ']';
  }
  if (value && typeof value === 'object') {
    return (
      '{' +
      Object.entries(value)
        .filter(([key]) => !['$schema', 'description', 'title'].includes(key))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => JSON.stringify(key) + ':' + schemaKey(entry))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value);
}

export class WindowsMcpConnection {
  private readonly client = new Client({ name: 'octopus-windows-mcp', version: executorProduct.version });
  private readonly abort = new AbortController();
  private owner: OwnedWindowsMcp | undefined;
  private transport: Transport | undefined;
  private closing: Promise<{ executionStopConfirmed: boolean }> | undefined;
  private status: WindowsMcpStatus;
  private readonly initializationTimeout: number;
  private readonly schemas = new Map<string, unknown>();

  /**
   * Owns one connection epoch; reconnection requires a new instance and a new capability check.
   */
  private constructor(private readonly selection: WindowsMcpSelection) {
    // Owned Python must import its desktop dependencies before it can answer initialize.
    this.initializationTimeout = selection.transport === 'stdio' ? 30000 : 10000;
    this.status = {
      transport: selection.transport,
      state: 'failed',
      backendEpoch: randomUUID(),
      protocolVersion: null,
      serverVersion: '',
      toolNames: [],
      computerAvailable: false,
    };
    this.client.onerror = () => {
      if (this.closing) {
        return;
      }
      this.status.state = 'failed';
      void this.close().catch(() => {});
    };
    this.client.onclose = () => {
      if (!this.closing) {
        this.status.state = 'failed';
        void this.close().catch(() => {});
      }
    };
  }

  /**
   * Initializes owned stdio within 45 seconds (30-second initialize); HTTP remains 15/10 seconds and discovery requests remain 10 seconds.
   * A successful handshake never enables unverified Computer control.
   * @throws A sanitized error if configuration, authentication, initialization or cleanup cannot be confirmed.
   */
  static async connect(
    input: WindowsMcpSelection,
    dependencies: WindowsMcpDependencies,
    signal?: AbortSignal
  ): Promise<WindowsMcpConnection> {
    const connection = new WindowsMcpConnection(windowsMcpSelectionSchema.parse(input));
    let timedOut = false;
    const timer = setTimeout(
      () => {
        timedOut = true;
        connection.abort.abort();
      },
      connection.selection.transport === 'stdio' ? 45000 : 15000
    );
    /**
     * Cancels only this connection's initialization and transport; externally owned execution is not confirmed stopped.
     */
    const cancel = () => connection.abort.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) {
      cancel();
    }
    try {
      await connection.initialize(dependencies);
      return connection;
    } catch (error) {
      clearTimeout(timer);
      const initializationTimedOut =
        timedOut ||
        (error instanceof McpError &&
          error.code === ErrorCode.RequestTimeout &&
          z
            .object({ timeout: z.union([z.literal(10000), z.literal(connection.initializationTimeout)]) })
            .safeParse(error.data).success);
      connection.status.state = 'failed';
      try {
        await connection.close();
      } catch {
        throw new Error('WINDOWS_MCP_CLEANUP_UNCONFIRMED');
      }
      if (initializationTimedOut) {
        throw new Error('WINDOWS_MCP_INITIALIZATION_TIMEOUT', { cause: error });
      }
      throw new Error('WINDOWS_MCP_CONNECTION_FAILED', { cause: error });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  }

  /**
   * Returns detached metadata without endpoint credentials, server instructions or arbitrary backend descriptions.
   */
  readStatus(): WindowsMcpStatus {
    return structuredClone(this.status);
  }

  /**
   * Requires every product extension with its exact versioned input contract; original Click/Type never qualify.
   */
  supportsProductContract(): boolean {
    return (
      this.status.state === 'connected' &&
      !this.closing &&
      !this.abort.signal.aborted &&
      Object.entries(backendSchemas).every(
        ([name, schema]) =>
          this.schemas.has(name) &&
          schemaKey(this.schemas.get(name)) ===
            schemaKey(z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' }))
      )
    );
  }

  /**
   * Calls only a validated product extension; disconnect, timeout and malformed results remain uncertain to the owner.
   * @returns A product response or a strict capture refusal envelope, preserved across independently bundled owners.
   * @throws If the connection or product contract is unavailable, or the backend response cannot be obtained.
   */
  async callProduct(name: BackendName, input: unknown): Promise<unknown> {
    if (!this.supportsProductContract() || !Object.hasOwn(backendSchemas, name)) {
      throw new Error('WINDOWS_MCP_PRODUCT_UNAVAILABLE');
    }
    const args = backendSchemas[name].parse(input);
    const result = await this.client.callTool({ name, arguments: args }, undefined, { timeout: 10000 });
    if (Buffer.byteLength(JSON.stringify(result)) > responseLimit) {
      throw new Error('WINDOWS_MCP_PRODUCT_RESULT_INVALID');
    }
    if (name === 'ExecutorCapture' && result.isError === true) {
      const refusal = captureFailureSchema.safeParse(result.structuredContent);
      if (refusal.success) {
        return refusal.data;
      }
    }
    if (name === 'ExecutorCapture' && captureFailureSchema.safeParse(result.structuredContent).success) {
      throw new Error('WINDOWS_MCP_PRODUCT_RESULT_INVALID');
    }
    if (result.isError || !result.structuredContent) {
      throw new Error('WINDOWS_MCP_PRODUCT_RESULT_INVALID');
    }
    return result.structuredContent;
  }

  /**
   * Closes this transport and confirms only owned local process cleanup; HTTP closure does not stop a desktop action.
   */
  close(): Promise<{ executionStopConfirmed: boolean }> {
    if (this.closing) {
      return this.closing;
    }
    const preserveFailure = this.status.state === 'failed';
    this.abort.abort();
    this.closing = Promise.resolve().then(async () => {
      try {
        try {
          await this.client.close();
        } finally {
          await this.owner?.stop();
        }
      } catch {
        this.status.state = 'failed';
        throw new Error('WINDOWS_MCP_CLEANUP_UNCONFIRMED');
      }
      if (!preserveFailure) {
        this.status.state = 'closed';
      }
      return { executionStopConfirmed: this.selection.transport === 'stdio' && this.owner !== undefined };
    });
    return this.closing;
  }

  /**
   * Selects one transport, negotiates protocol and bounds tool discovery without fallback or automatic reconnect.
   */
  private async initialize(dependencies: WindowsMcpDependencies): Promise<void> {
    this.abort.signal.throwIfAborted();
    if (this.selection.transport === 'stdio') {
      if (!dependencies.openLocal) {
        throw new Error('Local owned backend is unavailable');
      }
      this.owner = await dependencies.openLocal();
      this.transport = this.owner.transport;
    } else {
      const token = await dependencies.readCredential?.(this.selection.credentialId);
      if (!token || !/^[A-Za-z0-9._~+/=-]{1,4096}$/.test(token)) {
        throw new Error('Private credential unavailable');
      }
      this.transport = new StreamableHTTPClientTransport(new URL(this.selection.endpoint), {
        requestInit: { headers: { Authorization: 'Bearer ' + token } },
        fetch: this.httpFetch(this.selection.endpoint, token),
        reconnectionOptions: {
          maxRetries: 0,
          initialReconnectionDelay: 1000,
          maxReconnectionDelay: 1000,
          reconnectionDelayGrowFactor: 1,
        },
      });
    }
    this.abort.signal.throwIfAborted();
    const transport = this.transport;
    const setProtocolVersion = transport.setProtocolVersion?.bind(transport);
    transport.setProtocolVersion = (version) => {
      this.status.protocolVersion = version;
      setProtocolVersion?.(version);
    };
    await this.client.connect(transport, {
      signal: this.abort.signal,
      timeout: this.initializationTimeout,
    });
    const server = this.client.getServerVersion();
    if (server?.name !== 'windows-mcp' || server.version.length > 128) {
      throw new Error('Unexpected Windows-MCP identity');
    }
    const names: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 4; page++) {
      const result = await this.client.listTools(cursor ? { cursor } : {}, {
        signal: this.abort.signal,
        timeout: 10000,
      });
      for (const tool of result.tools) {
        if (
          !/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(tool.name) ||
          names.includes(tool.name) ||
          names.length >= 64
        ) {
          throw new Error('Invalid backend tool discovery');
        }
        names.push(tool.name);
        if (Buffer.byteLength(JSON.stringify(tool.inputSchema)) > 64 * 1024) {
          throw new Error('Backend schema exceeds limit');
        }
        this.schemas.set(tool.name, structuredClone(tool.inputSchema));
      }
      cursor = result.nextCursor;
      if (!cursor) {
        break;
      }
      if (cursor.length > 1024 || page === 3) {
        throw new Error('Backend discovery exceeds limit');
      }
    }
    this.abort.signal.throwIfAborted();
    if (this.closing) {
      throw new Error('Backend connection closed');
    }
    this.status = { ...this.status, state: 'connected', serverVersion: server.version, toolNames: names };
  }

  /**
   * Pins every HTTP request to the approved endpoint, refuses redirects and caps bytes before SDK parsing.
   */
  private httpFetch(endpoint: string, token: string): FetchLike {
    const approved = new URL(endpoint).href;
    return async (url, init) => {
      if (new URL(url).href !== approved) {
        throw new Error('Unexpected backend endpoint');
      }
      const headers = new Headers(init?.headers);
      headers.set('Authorization', 'Bearer ' + token);
      const response = await fetch(approved, {
        ...init,
        headers,
        redirect: 'error',
        signal: AbortSignal.any([this.abort.signal, ...(init?.signal ? [init.signal] : [])]),
      });
      if (!response.body) {
        return response;
      }
      const reader = response.body.getReader();
      let bytes = 0;
      let cancelled = false;
      const bounded = new ReadableStream<Uint8Array>({
        /**
         * Reads at most one chunk and closes the connection on a response budget violation.
         */
        pull: async (controller) => {
          try {
            const chunk = await reader.read();
            if (chunk.done) {
              controller.close();
              return;
            }
            bytes += chunk.value.byteLength;
            if (bytes > responseLimit) {
              throw new Error('Backend response exceeds limit');
            }
            controller.enqueue(chunk.value);
          } catch {
            if (cancelled || this.abort.signal.aborted) {
              return;
            }
            controller.error(new Error('WINDOWS_MCP_RESPONSE_FAILED'));
            await reader.cancel().catch(() => {});
            this.status.state = 'failed';
            void this.close().catch(() => {});
          }
        },
        /**
         * Releases only this request's response reader when SDK stops consuming it.
         */
        cancel: () => {
          cancelled = true;
          return reader.cancel();
        },
      });
      return new Response(bounded, { status: response.status, headers: response.headers });
    };
  }
}
