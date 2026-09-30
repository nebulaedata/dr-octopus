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

export type McpServerConnectivityStatus = 'connected' | 'failed' | 'needs_auth' | 'disabled' | 'unsupported';

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
  inheritEnv?: boolean;
  debug?: boolean;
  trace?: boolean;
  searchKeywords?: Record<string, string[]>;
  externalFields?: string[];
  auth: {
    type: 'none' | 'oauth' | 'bearer' | 'auto';
    bearerTokenEnv?: string;
    bearerTokenStored: boolean;
    oauthClientId?: string;
    oauthScope?: string;
    secretConfigured: boolean;
    bearerTokenConfigured?: boolean;
    oauthClientSecretConfigured?: boolean;
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
const SecretValueSchema = z
  .string()
  .max(16_384)
  .refine((value) => !value.startsWith('!'), {
    message: 'Executable secret expressions must be managed outside this form.',
  });
const SecretUpdateSchema = SecretValueSchema.pipe(z.string().min(1)).nullable().optional();
const EnvironmentBindingSchema = z
  .object({
    name: z
      .string()
      .max(128)
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/u),
    value: SecretValueSchema.optional(),
  })
  .strict();
const HeaderBindingSchema = z
  .object({
    name: z
      .string()
      .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u)
      .max(256),
    value: SecretValueSchema.refine((value) => !/[\r\n]/u.test(value)).optional(),
  })
  .strict();

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
    inheritEnv: z.boolean().optional(),
    environment: z.array(EnvironmentBindingSchema).max(128).optional(),
    headers: z.array(HeaderBindingSchema).max(128).optional(),
    debug: z.boolean().optional(),
    trace: z.boolean().optional(),
    searchKeywords: z
      .record(ToolPatternSchema, z.array(ToolPatternSchema).max(64))
      .refine((value) => Object.keys(value).length <= 256)
      .optional(),
    auth: z
      .object({
        type: z.enum(['none', 'oauth', 'bearer', 'auto']).default('auto'),
        bearerTokenEnv: z
          .string()
          .trim()
          .regex(/^[A-Za-z_][A-Za-z0-9_]*$/u)
          .optional(),
        bearerTokenStored: z.boolean().default(false),
        bearerToken: SecretUpdateSchema.refine(
          (value) => value === null || value === undefined || !/[\r\n]/u.test(value)
        ),
        oauthClientSecret: SecretUpdateSchema,
        oauthClientId: z.string().trim().max(512).optional(),
        oauthScope: z.string().trim().max(2_048).optional(),
      })
      .strict()
      .default({ type: 'auto', bearerTokenStored: false }),
  })
  .strict()
  .superRefine((value, ctx) => {
    const invalid = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (
      value.connection.type !== 'stdio' &&
      (value.environment !== undefined || value.inheritEnv !== undefined)
    ) {
      invalid('connection', 'Process environment requires stdio.');
    }
    if (
      value.connection.type !== 'http' &&
      (value.headers !== undefined ||
        !['none', 'auto'].includes(value.auth.type) ||
        value.auth.bearerToken !== undefined ||
        value.auth.oauthClientSecret !== undefined ||
        value.auth.bearerTokenEnv !== undefined ||
        value.auth.bearerTokenStored ||
        value.auth.oauthClientId !== undefined ||
        value.auth.oauthScope !== undefined)
    ) {
      invalid('auth', 'HTTP credentials require HTTP transport.');
    }
    if (
      (value.auth.bearerToken && (value.auth.bearerTokenEnv || value.auth.bearerTokenStored)) ||
      (value.auth.bearerTokenEnv && value.auth.bearerTokenStored)
    ) {
      invalid('auth', 'Choose one Bearer credential source.');
    }
    if (
      value.auth.type !== 'bearer' &&
      (value.auth.bearerToken !== undefined || value.auth.bearerTokenEnv || value.auth.bearerTokenStored)
    ) {
      invalid('auth', 'Bearer credentials require Bearer authentication.');
    }
    if (
      value.auth.type !== 'oauth' &&
      (value.auth.oauthClientSecret !== undefined || value.auth.oauthClientId || value.auth.oauthScope)
    ) {
      invalid('auth', 'OAuth credentials require OAuth authentication.');
    }
    for (const [field, entries] of [
      ['environment', value.environment],
      ['headers', value.headers],
    ] as const) {
      const names =
        entries?.map((entry) => (field === 'headers' ? entry.name.toLowerCase() : entry.name)) ?? [];
      if (new Set(names).size !== names.length) {
        invalid(field, 'Duplicate binding names.');
      }
    }
    if (
      value.auth.type === 'bearer' &&
      value.headers?.some((entry) => entry.name.toLowerCase() === 'authorization')
    ) {
      invalid('headers', 'Bearer authentication cannot also supply an Authorization header.');
    }
  });

export const CreateMcpServerBodySchema = McpServerConfigurationInputSchema.safeExtend({
  name: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u),
  revision: z.string().min(1).max(128),
});

export const UpdateMcpServerBodySchema = McpServerConfigurationInputSchema.safeExtend({
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
