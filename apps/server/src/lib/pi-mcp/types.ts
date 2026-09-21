/**
 * @author Codex
 * @description Defines the Server-owned boundary around pi-mcp-adapter configuration APIs.
 */

import type {
  CreateMcpServerBody,
  McpServerCatalogDto,
  McpServerConnectivityDto,
  McpServerDetailDto,
  McpServerMutationDto,
  UpdateMcpServerActivationBody,
  UpdateMcpServerBody,
} from '@octopus/shared/protocol';
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

export interface PiMcpStore {
  /** Lists the secret-free user-scope MCP catalog. */
  list(): Promise<McpServerCatalogDto>;
  /** Resolves one secret-free MCP Server detail. */
  get(serverKey: string): Promise<McpServerDetailDto | undefined>;
  /** Actively probes every effective MCP Server through an isolated Host connection. */
  probeConnectivity(serverKey?: string): Promise<McpServerConnectivityDto>;
  /** Creates one Pi-global MCP Server. */
  create(input: CreateMcpServerBody): Promise<McpServerMutationDto>;
  /** Replaces editable fields on one Pi-global MCP Server. */
  update(serverKey: string, input: UpdateMcpServerBody): Promise<McpServerMutationDto>;
  /** Writes the smallest possible enabled override. */
  setActivation(serverKey: string, input: UpdateMcpServerActivationBody): Promise<McpServerMutationDto>;
  /** Deletes an owned Server or a Pi-global activation override. */
  remove(serverKey: string, revision: string): Promise<McpServerMutationDto>;
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
