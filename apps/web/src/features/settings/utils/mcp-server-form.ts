/**
 * @author Codex
 * @description Converts MCP editor drafts into validated write-only configuration updates.
 */

import { McpServerConfigurationInputSchema } from '@octopus/shared/protocol';
import type { McpServerDetailDto } from '@octopus/shared/protocol';

export interface McpBindingDraft {
  name: string;
  value?: string;
}

/**
 * Initializes one editor without copying existing secrets into browser state.
 */
export function mcpFormDefaults(server?: McpServerDetailDto) {
  const connection = server?.connection;
  let target = '';
  if (connection?.type === 'stdio') {
    target = connection.command;
  }
  if (connection?.type === 'http') {
    target = connection.url;
  }
  if (connection?.type === 'socket') {
    target = connection.socket;
  }
  let directMode = 'off';
  if (server?.directTools === true) {
    directMode = 'all';
  }
  if (server?.directTools === 'search') {
    directMode = 'search';
  }
  if (Array.isArray(server?.directTools)) {
    directMode = 'patterns';
  }
  let bearerSource = 'token';
  if (server?.auth.bearerTokenEnv) {
    bearerSource = 'environment';
  } else if (server?.auth.bearerTokenStored) {
    bearerSource = 'store';
  }
  return {
    name: server?.name ?? '',
    description: server?.description ?? '',
    transport: String(
      connection?.type === 'http' || connection?.type === 'socket' ? connection.type : 'stdio'
    ),
    target,
    args: connection?.type === 'stdio' ? connection.args.join('\n') : '',
    cwd: connection?.type === 'stdio' ? (connection.cwd ?? '') : '',
    inheritEnv: server?.inheritEnv ?? true,
    httpTransport: String(connection?.type === 'http' ? connection.transport : 'auto'),
    environment: (server?.secretBindings
      .filter((b) => b.kind === 'environment')
      .map(({ name }) => ({ name })) ?? []) as McpBindingDraft[],
    headers: (server?.secretBindings.filter((b) => b.kind === 'header').map(({ name }) => ({ name })) ??
      []) as McpBindingDraft[],
    authType: String(server?.auth.type ?? 'auto'),
    bearerSource,
    bearerToken: '',
    clearBearer: false,
    bearerTokenEnv: server?.auth.bearerTokenEnv ?? '',
    oauthClientId: server?.auth.oauthClientId ?? '',
    oauthScope: server?.auth.oauthScope ?? '',
    oauthClientSecret: '',
    clearOAuth: false,
    lifecycle: String(server?.lifecycle ?? 'lazy'),
    idleTimeoutMinutes: server?.idleTimeoutMinutes?.toString() ?? '',
    requestTimeoutMs: server?.requestTimeoutMs?.toString() ?? '',
    protocolVersion: String(server?.protocolVersion ?? 'legacy'),
    directMode,
    directPatterns: Array.isArray(server?.directTools) ? server.directTools.join('\n') : '',
    exposeResources: server?.exposeResources ?? true,
    toolPrefix: String(server?.toolPrefix ?? 'server'),
    includeTools: server?.includeTools.join('\n') ?? '',
    excludeTools: server?.excludeTools.join('\n') ?? '',
    debug: server?.debug ?? false,
    trace: server?.trace ?? false,
    searchKeywords: JSON.stringify(server?.searchKeywords ?? {}, null, 2),
  };
}

export type McpFormValues = ReturnType<typeof mcpFormDefaults>;

/**
 * Tests whether same-target secret bindings can safely be retained.
 */
export function mcpTargetChanged(value: McpFormValues, server?: McpServerDetailDto): boolean {
  if (!server) {
    return false;
  }
  const initial = mcpFormDefaults(server);
  return value.transport !== initial.transport || value.target.trim() !== initial.target;
}

/**
 * Parses line-oriented lists while preserving whitespace inside each item.
 */
function lines(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Builds a closed protocol input; malformed numbers and JSON remain validation failures.
 */
export function mcpFormInput(value: McpFormValues, server?: McpServerDetailDto) {
  const changed = mcpTargetChanged(value, server);
  const bindings = (entries: McpBindingDraft[]) =>
    entries.filter((entry) => !changed || entry.value !== undefined);
  let connection: unknown;
  if (value.transport === 'http') {
    connection = { type: 'http', url: value.target.trim(), transport: value.httpTransport };
  } else if (value.transport === 'socket') {
    connection = { type: 'socket', socket: value.target };
  } else {
    connection = {
      type: 'stdio',
      command: value.target,
      args: lines(value.args),
      ...(value.cwd.trim() ? { cwd: value.cwd.trim() } : {}),
    };
  }
  const auth: Record<string, unknown> = {
    type: value.transport === 'http' ? value.authType : 'none',
    bearerTokenStored: false,
  };
  if (value.transport === 'http' && value.authType === 'bearer') {
    if (value.bearerSource === 'environment') {
      auth.bearerTokenEnv = value.bearerTokenEnv;
    } else if (value.bearerSource === 'store') {
      auth.bearerTokenStored = !changed;
    } else if (value.clearBearer) {
      auth.bearerToken = null;
    } else if (value.bearerToken) {
      auth.bearerToken = value.bearerToken;
    }
  }
  if (value.transport === 'http' && value.authType === 'oauth') {
    if (value.oauthClientId.trim()) {
      auth.oauthClientId = value.oauthClientId.trim();
    }
    if (value.oauthScope.trim()) {
      auth.oauthScope = value.oauthScope.trim();
    }
    if (value.clearOAuth) {
      auth.oauthClientSecret = null;
    } else if (value.oauthClientSecret) {
      auth.oauthClientSecret = value.oauthClientSecret;
    }
  }
  let directTools: boolean | string | string[] = false;
  if (value.directMode === 'all') {
    directTools = true;
  }
  if (value.directMode === 'search') {
    directTools = 'search';
  }
  if (value.directMode === 'patterns') {
    directTools = lines(value.directPatterns);
  }
  return McpServerConfigurationInputSchema.parse({
    description: value.description,
    connection,
    auth,
    enabled: server?.enabled ?? true,
    ...(value.transport === 'stdio'
      ? { inheritEnv: value.inheritEnv, environment: bindings(value.environment) }
      : {}),
    ...(value.transport === 'http' ? { headers: bindings(value.headers) } : {}),
    lifecycle: value.lifecycle,
    ...(value.idleTimeoutMinutes.trim() ? { idleTimeoutMinutes: Number(value.idleTimeoutMinutes) } : {}),
    ...(value.requestTimeoutMs.trim() ? { requestTimeoutMs: Number(value.requestTimeoutMs) } : {}),
    protocolVersion: value.protocolVersion,
    directTools,
    exposeResources: value.exposeResources,
    toolPrefix: value.toolPrefix,
    includeTools: lines(value.includeTools),
    excludeTools: lines(value.excludeTools),
    debug: value.debug,
    trace: value.trace,
    searchKeywords: JSON.parse(value.searchKeywords || '{}'),
  });
}
