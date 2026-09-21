/**
 * @author Codex
 * @description Resolve saved global Pi MCP definitions without workspace discovery or credential duplication.
 */
import { loadMcpConfig } from 'pi-mcp-adapter/config';
import { KnowledgeError } from '../../definitions/error.js';
import type { ServerEntry } from 'pi-mcp-adapter/types';

/**
 * Public parser is synchronous; restore process overrides before any asynchronous work can run.
 */
export function globalKnowledgeConnections(agentDir: string): Record<string, ServerEntry> {
  const values = {
    PI_CODING_AGENT_DIR: agentDir,
    DR_OCTOPUS_CODING_AGENT_DIR: agentDir,
    PI_MCP_CONFIG_MODE: 'exclusive',
  };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, values);
    return loadMcpConfig(undefined, agentDir).mcpServers;
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

/**
 * Use a direct static bearer connection; reject executable headers, OAuth, stdio and disabled entries.
 */
export function resolveKnowledgeConnection(
  agentDir: string,
  name: string
): { url: string; headers: Record<string, string> } {
  const entry = globalKnowledgeConnections(agentDir)[name];
  if (
    !entry?.url ||
    entry.disabled ||
    entry.command ||
    entry.socket ||
    entry.requestHeadersCommand ||
    entry.auth === 'oauth' ||
    entry.httpTransport === 'sse'
  ) {
    throw new KnowledgeError('INCOMPATIBLE', '请选择已启用的全局 Streamable HTTP Bearer 连接');
  }
  const headers = Object.fromEntries(
    Object.entries(entry.headers ?? {}).map(([key, value]) => [key, expand(value)])
  );
  const token = entry.bearerToken ?? (entry.bearerTokenEnv ? process.env[entry.bearerTokenEnv] : undefined);
  if (token) {
    headers.Authorization = `Bearer ${expand(token)}`;
  }
  const authorization = new Headers(headers).get('authorization');
  if (!authorization?.startsWith('Bearer ') || !authorization.slice(7).trim()) {
    throw new KnowledgeError(
      'AUTH_REQUIRED',
      '请在全局 MCP 连接中配置 Bearer token 或 Authorization 环境变量引用'
    );
  }
  return { url: expand(entry.url), headers };
}

/**
 * Resolve explicit environment bindings without shell expansion or logging secret values.
 */
function expand(value: string): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/gu, (_match, name: string) => {
    const result = process.env[name];
    if (!result) {
      throw new KnowledgeError('AUTH_REQUIRED', 'MCP 环境变量未配置');
    }
    return result;
  });
}
