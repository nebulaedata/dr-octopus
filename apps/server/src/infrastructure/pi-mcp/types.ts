/**
 * @author Codex
 * @description Defines the Server-owned boundary around pi-mcp-adapter configuration APIs.
 */

import type { McpConfig, ServerEntry } from 'pi-mcp-adapter/types';

export interface PiMcpServerEntry extends ServerEntry {
  'x-dr-octopus'?: {
    description?: string;
    [key: string]: unknown;
  };
}

export interface PiMcpConfig extends Omit<McpConfig, 'mcpServers'> {
  mcpServers: Record<string, PiMcpServerEntry>;
}

export interface PiMcpAdapterConfigApi {
  loadMcpConfig(overridePath?: string, cwd?: string): PiMcpConfig;
  getMcpDiscoverySummary(
    overridePath?: string,
    cwd?: string,
    options?: { includeHostConfigs?: boolean }
  ): {
    sources: Array<{ id: string; path: string; readPath?: string; serverCount: number }>;
    conflicts: Array<{ serverName: string; sources: unknown[] }>;
  };
  getServerProvenance(
    overridePath?: string,
    cwd?: string
  ): Map<string, { path: string; kind: 'user' | 'project' | 'import'; importKind?: string }>;
}

export class PiMcpConfigError extends Error {
  /**
   * Creates a stable infrastructure error without exposing raw configuration.
   */
  public constructor(
    public readonly code:
      | 'MCP_CONFIG_INVALID'
      | 'MCP_CONFIG_REVISION_CONFLICT'
      | 'MCP_SERVER_NOT_FOUND'
      | 'MCP_SERVER_CONFLICT'
      | 'MCP_SERVER_READONLY',
    message: string,
    public readonly statusCode: number,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'PiMcpConfigError';
  }
}

export interface CreatePiMcpStoreOptions {
  agentDir: string;
  controlPlaneCwd?: string;
  adapterApi?: PiMcpAdapterConfigApi;
  adapterVersion?: string;
}
