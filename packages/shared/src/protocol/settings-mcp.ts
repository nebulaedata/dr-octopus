/**
 * @author Codex
 * @description Defines secret-free Settings contracts for user-scope MCP server configuration.
 */

import { z } from 'zod';

export type McpServerTransport = 'stdio' | 'http' | 'socket' | 'invalid';
export type McpServerSource =
  | 'shared_global'
  | 'agents_global'
  | 'agents_nested_global'
  | 'pi_global'
  | 'host_import'
  | 'package_or_plugin';
export type McpServerManagement = 'owned' | 'override_only' | 'readonly';

export interface McpServerSummaryDto {
  serverKey: string;
  name: string;
  transport: McpServerTransport;
  enabled: boolean;
  source: McpServerSource;
  management: McpServerManagement;
  conflictCount: number;
  effect: 'agent_restart';
}

export interface McpServerCatalogDto {
  servers: McpServerSummaryDto[];
  adapter: {
    package: 'pi-mcp-adapter';
    version: '2.34.0';
    available: boolean;
  };
  revision: string;
}

export type McpServerConnectivityStatus = 'connected' | 'failed' | 'needs_auth' | 'disabled';

export interface McpServerConnectivityDto {
  revision: string;
  checkedAt: string;
  servers: Array<{
    serverKey: string;
    status: McpServerConnectivityStatus;
    toolCount?: number;
  }>;
}

export type McpServerConnectionDto =
  | { type: 'stdio'; command: string; args: string[]; cwd?: string }
  | { type: 'http'; url: string; transport: 'auto' | 'streamable-http' | 'sse' }
  | { type: 'socket'; socket: string }
  | { type: 'invalid' };

export interface McpServerDetailDto extends McpServerSummaryDto {
  description: string;
  connection: McpServerConnectionDto;
  lifecycle: 'lazy' | 'eager' | 'keep-alive' | 'lazy-keep-alive';
  idleTimeoutMinutes?: number;
  requestTimeoutMs?: number;
  protocolVersion: 'legacy' | 'auto' | '2026-07-28';
  exposeResources: boolean;
  directTools: boolean | string[] | 'search';
  toolPrefix: 'server' | 'short' | 'none' | 'mcp';
  includeTools: string[];
  excludeTools: string[];
  auth: {
    type: 'none' | 'oauth' | 'bearer' | 'auto';
    bearerTokenEnv?: string;
    bearerTokenStored: boolean;
    oauthClientId?: string;
    oauthScope?: string;
    secretConfigured: boolean;
  };
  secretBindings: Array<{ kind: 'environment' | 'header' | 'oauth_client_secret'; name: string }>;
  capabilities: { edit: boolean; remove: boolean; toggle: boolean };
}

export interface McpSettingsWarningDto {
  code: string;
  message: string;
  nextAction: 'none' | 'refresh' | 'restart_agent';
}

export interface McpServerMutationDto {
  outcome: 'applied' | 'unchanged';
  warnings: McpSettingsWarningDto[];
  effect: {
    kind: 'agent_restart';
    currentAgentRuntimes: 'unchanged';
    requiredAction: 'restart_agent';
  };
  revision: string;
  server?: McpServerDetailDto;
}

const BoundedStringSchema = z.string().trim().min(1).max(2_048);
const ToolPatternSchema = z.string().trim().min(1).max(256);

export const McpServerKeySchema = z.string().regex(/^mcp1_[A-Za-z0-9_-]{43}$/u);

export const McpServerConnectionInputSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('stdio'),
      command: BoundedStringSchema,
      args: z.array(z.string().max(4_096)).max(128).default([]),
      cwd: z.string().trim().max(2_048).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('http'),
      url: z.url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
        message: 'MCP HTTP URLs must use http or https.',
      }),
      transport: z.enum(['auto', 'streamable-http', 'sse']).default('auto'),
    })
    .strict(),
  z.object({ type: z.literal('socket'), socket: BoundedStringSchema }).strict(),
]);

export const McpServerConfigurationInputSchema = z
  .object({
    description: z.string().trim().max(512).default(''),
    connection: McpServerConnectionInputSchema,
    enabled: z.boolean().default(true),
    lifecycle: z.enum(['lazy', 'eager', 'keep-alive', 'lazy-keep-alive']).default('lazy'),
    idleTimeoutMinutes: z.number().int().min(0).max(1_440).optional(),
    requestTimeoutMs: z.number().int().min(0).max(600_000).optional(),
    protocolVersion: z.enum(['legacy', 'auto', '2026-07-28']).default('legacy'),
    exposeResources: z.boolean().default(true),
    directTools: z
      .union([z.boolean(), z.array(ToolPatternSchema).max(256), z.literal('search')])
      .default(false),
    toolPrefix: z.enum(['server', 'short', 'none', 'mcp']).default('server'),
    includeTools: z.array(ToolPatternSchema).max(256).default([]),
    excludeTools: z.array(ToolPatternSchema).max(256).default([]),
    auth: z
      .object({
        type: z.enum(['none', 'oauth', 'bearer', 'auto']).default('auto'),
        bearerTokenEnv: z
          .string()
          .trim()
          .regex(/^[A-Za-z_][A-Za-z0-9_]*$/u)
          .optional(),
        bearerTokenStored: z.boolean().default(false),
        oauthClientId: z.string().trim().max(512).optional(),
        oauthScope: z.string().trim().max(2_048).optional(),
      })
      .strict()
      .default({ type: 'auto', bearerTokenStored: false }),
  })
  .strict();

export const CreateMcpServerBodySchema = McpServerConfigurationInputSchema.extend({
  name: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u),
  revision: z.string().min(1).max(128),
});

export const UpdateMcpServerBodySchema = McpServerConfigurationInputSchema.extend({
  revision: z.string().min(1).max(128),
});

export const UpdateMcpServerActivationBodySchema = z
  .object({
    enabled: z.boolean(),
    revision: z.string().min(1).max(128),
  })
  .strict();

export const DeleteMcpServerBodySchema = z.object({ revision: z.string().min(1).max(128) }).strict();

export type McpServerConfigurationInput = z.infer<typeof McpServerConfigurationInputSchema>;
export type CreateMcpServerBody = z.infer<typeof CreateMcpServerBodySchema>;
export type UpdateMcpServerBody = z.infer<typeof UpdateMcpServerBodySchema>;
export type UpdateMcpServerActivationBody = z.infer<typeof UpdateMcpServerActivationBodySchema>;
export type DeleteMcpServerBody = z.infer<typeof DeleteMcpServerBodySchema>;
