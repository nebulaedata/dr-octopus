/**
 * @author Codex
 * @description Owns a finite upstream Windows-MCP stdio session, pinned schemas and control notifications; never proxies arbitrary tools.
 */
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { LoggingMessageNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { WindowsMcpStatus } from '../../contracts/windows-mcp';
import { controlStatusSchema, type ControlStatus, type UpstreamName } from './computer-inputs';
import { windowsMcpSchemas, windowsMcpVersion } from './windows-mcp-schemas';
export type OwnedWindowsMcp = {
  transport: Transport;
  /**
   * Confirms owned process-tree exit; rejection leaves execution uncertain.
   */
  stop: () => Promise<void>;
};
/**
 * Compares contract structure, excluding descriptive annotations only.
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
        .map(([key, item]) => JSON.stringify(key) + ':' + schemaKey(item))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value);
}
export class WindowsMcpConnection {
  private readonly client = new Client({ name: 'octopus-desktop', version: '1' });
  private closing: Promise<{ executionStopConfirmed: boolean }> | undefined;
  private status: WindowsMcpStatus = {
    state: 'failed',
    backendEpoch: randomUUID(),
    upstreamVersion: windowsMcpVersion,
    serverVersion: '',
    toolNames: [],
  };
  private readonly listeners = new Set<(status: ControlStatus) => void>();
  /**
   * Takes ownership before initialize so every failure can clean the same Job.
   */
  private constructor(private readonly owner: OwnedWindowsMcp) {
    this.client.onclose = () => {
      this.status.state = 'closed';
    };
    this.client.onerror = () => {
      this.status.state = 'failed';
      void this.close().catch(() => {});
    };
    this.client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
      if (notification.params.logger !== 'windows-mcp.control') {
        return;
      }
      const data = notification.params.data;
      const parsed = controlStatusSchema.safeParse(
        data && typeof data === 'object' && 'status' in data ? data.status : null
      );
      if (parsed.success) {
        for (const listener of this.listeners) {
          listener(parsed.data);
        }
      }
    });
  }
  /**
   * Initializes within 45 seconds and rejects extra, missing or incompatible upstream tools without fallback.
   */
  static async connect(owner: OwnedWindowsMcp, signal?: AbortSignal): Promise<WindowsMcpConnection> {
    const connection = new WindowsMcpConnection(owner);
    const abort = signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000);
    try {
      await connection.client.connect(owner.transport, { timeout: 30000, signal: abort });
      const server = connection.client.getServerVersion();
      if (server?.name !== 'windows-mcp') {
        throw new Error('Unexpected upstream identity');
      }
      const result = await connection.client.listTools(undefined, { timeout: 10000, signal: abort });
      if (result.nextCursor || result.tools.length !== Object.keys(windowsMcpSchemas).length) {
        throw new Error('Unexpected upstream tools');
      }
      for (const [name, expected] of Object.entries(windowsMcpSchemas)) {
        const found = result.tools.filter((tool) => tool.name === name);
        if (found.length !== 1 || schemaKey(found[0].inputSchema) !== schemaKey(expected)) {
          throw new Error('Incompatible upstream schema');
        }
      }
      connection.status = {
        ...connection.status,
        state: 'connected',
        serverVersion: server.version,
        toolNames: result.tools.map((tool) => tool.name),
      };
      return connection;
    } catch (cause) {
      try {
        await connection.close();
      } catch (cleanupError) {
        throw new AggregateError([cause, cleanupError], 'WINDOWS_MCP_CLEANUP_UNCONFIRMED', {
          cause: cleanupError,
        });
      }
      throw new Error('WINDOWS_MCP_CONNECTION_FAILED', { cause });
    }
  }
  /**
   * Reports the negotiated, still-owned connection without using the framework version as package identity.
   */
  readStatus(): WindowsMcpStatus {
    return structuredClone(this.status);
  }
  /**
   * Requires the pinned negotiation and a live transport.
   */
  isConnected(): boolean {
    return this.status.state === 'connected' && !this.closing;
  }
  /**
   * Subscribes only to validated upstream control status; the owner removes its listener on retirement.
   */
  onControl(listener: (status: ControlStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  /**
   * Calls the fixed whitelist once; transport timeout never proves the desktop action stopped.
   */
  async callTool(
    name: UpstreamName,
    input: Record<string, unknown>,
    options: { timeoutMs: number }
  ): Promise<CallToolResult> {
    if (!this.isConnected() || !Object.hasOwn(windowsMcpSchemas, name)) {
      throw new Error('WINDOWS_MCP_PRODUCT_UNAVAILABLE');
    }
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
      throw new Error('WINDOWS_MCP_INVALID_TIMEOUT');
    }
    const result = await this.client.callTool({ name, arguments: input }, undefined, {
      timeout: options.timeoutMs,
      maxTotalTimeout: options.timeoutMs,
      resetTimeoutOnProgress: false,
    });
    if (Buffer.byteLength(JSON.stringify(result)) > 12 * 1024 * 1024) {
      throw new Error('WINDOWS_MCP_RESULT_LIMIT');
    }
    return result as CallToolResult;
  }
  /**
   * Confirms the owned Job after closing the protocol, including failed initialization.
   */
  close(): Promise<{ executionStopConfirmed: boolean }> {
    // Cache before invoking SDK cleanup: transport callbacks may request close again.
    this.closing ??= Promise.resolve().then(() => this.shutdown());
    return this.closing;
  }

  /**
   * Preserves failed cleanup as a failed state and always retires notification listeners.
   */
  private async shutdown(): Promise<{ executionStopConfirmed: boolean }> {
    try {
      try {
        await this.client.close();
      } finally {
        await this.owner.stop();
      }
      this.status.state = 'closed';
      return { executionStopConfirmed: true };
    } catch (cause) {
      this.status.state = 'failed';
      throw new Error('WINDOWS_MCP_CLEANUP_UNCONFIRMED', { cause });
    } finally {
      this.listeners.clear();
    }
  }
}
