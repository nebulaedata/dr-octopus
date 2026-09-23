/**
 * @author Codex
 * @description Converts pi-mcp-adapter definitions into secret-free Settings projections.
 */

import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type {
  McpServerConfigurationInput,
  McpServerConnectionDto,
  McpServerDetailDto,
  McpServerManagement,
  McpServerSource,
} from '@octopus/shared/protocol';
import type { PiMcpServerEntry } from './types.js';

export interface McpProjectionContext {
  globalServers: Record<string, PiMcpServerEntry>;
  provenance: Map<string, { path: string; kind: 'user' | 'project' | 'import'; importKind?: string }>;
  sourcePaths: Map<string, string>;
  conflicts: Map<string, number>;
}

const MANAGED_FIELDS = [
  'command',
  'args',
  'cwd',
  'url',
  'socket',
  'env',
  'headers',
  'requestHeadersCommand',
  'httpTransport',
  'disabled',
  'lifecycle',
  'idleTimeout',
  'requestTimeoutMs',
  'protocolVersion',
  'exposeResources',
  'directTools',
  'toolPrefix',
  'includeTools',
  'excludeTools',
  'auth',
  'oauth',
  'bearerToken',
  'bearerTokenEnv',
  'bearerTokenStore',
] as const;

/**
 * Computes a stable opaque route key from the complete Server name.
 */
export function toMcpServerKey(name: string): string {
  return `mcp1_${createHash('sha256').update(name, 'utf8').digest('base64url')}`;
}

/**
 * Projects one configured transport and rejects ambiguous definitions.
 */
export function projectMcpConnection(entry: PiMcpServerEntry): McpServerConnectionDto {
  const transports = [
    typeof entry.command === 'string',
    typeof entry.url === 'string',
    typeof entry.socket === 'string',
  ];
  if (transports.filter(Boolean).length !== 1) {
    return { type: 'invalid' };
  }
  if (typeof entry.command === 'string') {
    return {
      type: 'stdio',
      command: entry.command,
      args: Array.isArray(entry.args)
        ? entry.args.filter((value): value is string => typeof value === 'string')
        : [],
      ...(typeof entry.cwd === 'string' ? { cwd: entry.cwd } : {}),
    };
  }
  if (typeof entry.url === 'string') {
    return { type: 'http', url: entry.url, transport: entry.httpTransport ?? 'auto' };
  }
  return { type: 'socket', socket: entry.socket! };
}

/**
 * Returns whether the Pi-global layer contains a complete owned definition.
 */
export function isOwnedMcpServer(entry: PiMcpServerEntry | undefined): boolean {
  return entry !== undefined && projectMcpConnection(entry).type !== 'invalid';
}

/**
 * Resolves source and mutation capabilities from adapter provenance.
 */
function projectSource(
  name: string,
  context: McpProjectionContext
): { source: McpServerSource; management: McpServerManagement } {
  if (isOwnedMcpServer(context.globalServers[name])) {
    return { source: 'pi_global', management: 'owned' };
  }
  const provenance = context.provenance.get(name);
  if (provenance === undefined) {
    return { source: 'package_or_plugin', management: 'readonly' };
  }
  const sourceId = context.sourcePaths.get(resolve(provenance.path));
  if (sourceId === 'pi-global') {
    return { source: 'pi_global', management: 'override_only' };
  }
  if (sourceId === 'shared-global') {
    return { source: 'shared_global', management: 'override_only' };
  }
  if (sourceId === 'agents-global') {
    return { source: 'agents_global', management: 'override_only' };
  }
  if (sourceId === 'agents-nested-global') {
    return { source: 'agents_nested_global', management: 'override_only' };
  }
  return { source: 'host_import', management: 'override_only' };
}

/**
 * Converts one effective definition into a bounded secret-free detail DTO.
 */
export function projectMcpServerDetail(
  name: string,
  entry: PiMcpServerEntry,
  context: McpProjectionContext
): McpServerDetailDto {
  const origin = projectSource(name, context);
  const connection = projectMcpConnection(entry);
  const hostMetadata = entry['x-dr-octopus'];
  const secretBindings: McpServerDetailDto['secretBindings'] = [
    ...Object.keys(entry.env ?? {}).map((bindingName) => ({
      kind: 'environment' as const,
      name: bindingName,
    })),
    ...Object.keys(entry.headers ?? {}).map((bindingName) => ({
      kind: 'header' as const,
      name: bindingName,
    })),
    ...(typeof entry.oauth === 'object' && typeof entry.oauth.clientSecret === 'string'
      ? [{ kind: 'oauth_client_secret' as const, name: 'clientSecret' }]
      : []),
  ];
  let authType: 'oauth' | 'bearer' | 'none' | 'auto';
  if (entry.auth === false) {
    authType = 'none';
  } else {
    if (entry.auth === 'oauth') {
      authType = 'oauth';
    } else {
      if (entry.auth === 'bearer') {
        authType = 'bearer';
      } else {
        authType = 'auto';
      }
    }
  }
  return {
    serverKey: toMcpServerKey(name),
    name,
    description:
      typeof hostMetadata?.description === 'string' ? hostMetadata.description.trim().slice(0, 512) : '',
    transport: connection.type,
    connection,
    enabled: entry.disabled !== true,
    ...origin,
    conflictCount: context.conflicts.get(name) ?? 0,
    effect: 'agent_restart',
    lifecycle: entry.lifecycle ?? 'lazy',
    ...(typeof entry.idleTimeout === 'number' ? { idleTimeoutMinutes: entry.idleTimeout } : {}),
    ...(typeof entry.requestTimeoutMs === 'number' ? { requestTimeoutMs: entry.requestTimeoutMs } : {}),
    protocolVersion: entry.protocolVersion ?? 'legacy',
    exposeResources: entry.exposeResources !== false,
    directTools: entry.directTools ?? false,
    toolPrefix: entry.toolPrefix ?? 'server',
    includeTools: entry.includeTools ?? [],
    excludeTools: entry.excludeTools ?? [],
    auth: {
      type: authType,
      ...(typeof entry.bearerTokenEnv === 'string' ? { bearerTokenEnv: entry.bearerTokenEnv } : {}),
      bearerTokenStored: entry.bearerTokenStore === true,
      ...(typeof entry.oauth === 'object' && typeof entry.oauth.clientId === 'string'
        ? { oauthClientId: entry.oauth.clientId }
        : {}),
      ...(typeof entry.oauth === 'object' && typeof entry.oauth.scope === 'string'
        ? { oauthScope: entry.oauth.scope }
        : {}),
      secretConfigured:
        typeof entry.bearerToken === 'string' || entry.bearerTokenStore === true || secretBindings.length > 0,
    },
    secretBindings,
    capabilities: {
      edit: origin.management === 'owned',
      remove: context.globalServers[name] !== undefined,
      toggle: origin.management !== 'readonly',
    },
  };
}

/**
 * Applies validated Host fields while preserving unowned adapter fields and existing literal secrets.
 */
export function applyMcpConfiguration(
  existing: PiMcpServerEntry,
  input: McpServerConfigurationInput
): PiMcpServerEntry {
  const next: PiMcpServerEntry = { ...existing };
  const sameStdioCommand = input.connection.type === 'stdio' && existing.command === input.connection.command;
  const sameHttpEndpoint = input.connection.type === 'http' && existing.url === input.connection.url;
  for (const field of MANAGED_FIELDS) {
    delete next[field];
  }
  const existingHostMetadata = existing['x-dr-octopus'];
  const hostMetadata =
    typeof existingHostMetadata === 'object' &&
    existingHostMetadata !== null &&
    !Array.isArray(existingHostMetadata)
      ? { ...existingHostMetadata }
      : {};
  delete hostMetadata.description;
  if (input.description) {
    hostMetadata.description = input.description;
  }
  if (Object.keys(hostMetadata).length > 0) {
    next['x-dr-octopus'] = hostMetadata;
  } else {
    delete next['x-dr-octopus'];
  }
  if (input.connection.type === 'stdio') {
    Object.assign(next, {
      command: input.connection.command,
      args: input.connection.args,
      ...(input.connection.cwd ? { cwd: input.connection.cwd } : {}),
    });
    if (sameStdioCommand && existing.env !== undefined) {
      next.env = existing.env;
    }
  } else if (input.connection.type === 'http') {
    Object.assign(next, {
      url: input.connection.url,
      ...(input.connection.transport === 'auto' ? {} : { httpTransport: input.connection.transport }),
    });
    if (sameHttpEndpoint && existing.headers !== undefined) {
      next.headers = existing.headers;
    }
    if (sameHttpEndpoint && existing.requestHeadersCommand !== undefined) {
      next.requestHeadersCommand = existing.requestHeadersCommand;
    }
  } else {
    next.socket = input.connection.socket;
  }
  if (!input.enabled) {
    next.disabled = true;
  }
  if (input.lifecycle !== 'lazy') {
    next.lifecycle = input.lifecycle;
  }
  if (input.idleTimeoutMinutes !== undefined) {
    next.idleTimeout = input.idleTimeoutMinutes;
  }
  if (input.requestTimeoutMs !== undefined) {
    next.requestTimeoutMs = input.requestTimeoutMs;
  }
  if (input.protocolVersion !== 'legacy') {
    next.protocolVersion = input.protocolVersion;
  }
  if (!input.exposeResources) {
    next.exposeResources = false;
  }
  if (input.directTools !== false) {
    next.directTools = input.directTools;
  }
  if (input.toolPrefix !== 'server') {
    next.toolPrefix = input.toolPrefix;
  }
  if (input.includeTools.length > 0) {
    next.includeTools = input.includeTools;
  }
  if (input.excludeTools.length > 0) {
    next.excludeTools = input.excludeTools;
  }
  applyAuth(next, existing, input, sameHttpEndpoint);
  return next;
}

/**
 * Applies the non-secret authentication selection and preserves existing opaque secret values.
 */
function applyAuth(
  next: PiMcpServerEntry,
  existing: PiMcpServerEntry,
  input: McpServerConfigurationInput,
  preserveHttpSecrets: boolean
): void {
  if (input.auth.type === 'auto' && preserveHttpSecrets) {
    if (existing.auth !== undefined) {
      next.auth = existing.auth;
    }
    if (existing.oauth !== undefined) {
      next.oauth = existing.oauth;
    }
    if (typeof existing.bearerToken === 'string') {
      next.bearerToken = existing.bearerToken;
    }
    if (typeof existing.bearerTokenEnv === 'string') {
      next.bearerTokenEnv = existing.bearerTokenEnv;
    }
    if (existing.bearerTokenStore === true) {
      next.bearerTokenStore = true;
    }
  }
  if (input.auth.type === 'none') {
    next.auth = false;
  }
  if (input.auth.type === 'oauth') {
    next.auth = 'oauth';
    next.oauth = {
      ...(preserveHttpSecrets &&
      typeof existing.oauth === 'object' &&
      typeof existing.oauth.clientSecret === 'string'
        ? { clientSecret: existing.oauth.clientSecret }
        : {}),
      ...(input.auth.oauthClientId ? { clientId: input.auth.oauthClientId } : {}),
      ...(input.auth.oauthScope ? { scope: input.auth.oauthScope } : {}),
    };
  }
  if (input.auth.type === 'bearer') {
    next.auth = 'bearer';
    if (input.auth.bearerTokenEnv) {
      next.bearerTokenEnv = input.auth.bearerTokenEnv;
    }
    if (input.auth.bearerTokenStored) {
      next.bearerTokenStore = true;
    }
    if (preserveHttpSecrets && typeof existing.bearerToken === 'string') {
      next.bearerToken = existing.bearerToken;
    }
  }
}
