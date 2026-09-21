/**
 * @author Codex
 * @description 识别 context-mode Pi 包并幂等维护其用户级 MCP server 配置。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { getAgentDir } from '@earendil-works/pi-coding-agent';

const CONTEXT_MODE_MCP_SERVER_NAME = 'context-mode';
const CONTEXT_MODE_MCP_CONFIG_FILE = 'mcp.json';
const CONTEXT_MODE_DATA_DIR_ENV = 'CONTEXT_MODE_DATA_DIR';
const CONTEXT_MODE_DIR_ENV = 'CONTEXT_MODE_DIR';

/**
 * 判断 Pi package source 是否指向 context-mode 包。
 * 同时兼容当前默认包名与用户提供页面中的 scoped fork。
 *
 * @param source Pi package source。
 * @returns source 是否需要配套注册 context-mode MCP server。
 */
export function isContextModeSource(source: string): boolean {
  return /^npm:(?:@h4rvey-g\/)?context-mode(?:@|$)/.test(source);
}

/**
 * 在 Pi 用户级 MCP 配置中补充 context-mode server，同时保留用户已有配置。
 * 由本模块生成的标准 server 会补齐存储目录变量；自定义 command 或 args 不会被覆盖。
 *
 * @param agentDir Pi Agent 用户级目录；默认使用 Pi 公共 API 解析的目录。
 * @returns 新增或补齐标准配置时为 true，无需变化或属于自定义配置时为 false。
 */
export async function ensureContextModeMcpConfigured(
  agentDir: string = getAgentDir()
): Promise<boolean> {
  const configPath = join(agentDir, CONTEXT_MODE_MCP_CONFIG_FILE);
  let root: Record<string, unknown> = {};

  try {
    const parsed = JSON.parse(await readFile(configPath, 'utf8')) as unknown;
    if (!isJsonObject(parsed)) {
      throw new Error(`${configPath} must contain a JSON object`);
    }
    root = parsed;
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) {
      throw error;
    }
  }

  const configuredServers = root.mcpServers;
  if (configuredServers !== undefined && !isJsonObject(configuredServers)) {
    throw new Error(`${configPath} property "mcpServers" must contain a JSON object`);
  }

  const mcpServers = configuredServers ?? {};
  const existingServer = mcpServers[CONTEXT_MODE_MCP_SERVER_NAME];
  const managedServer = createManagedContextModeServer(agentDir, existingServer);
  if (managedServer === undefined) {
    return false;
  }

  await mkdir(agentDir, { recursive: true });
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        ...root,
        mcpServers: {
          ...mcpServers,
          [CONTEXT_MODE_MCP_SERVER_NAME]: managedServer,
        },
      },
      null,
      2
    )}\n`,
    'utf8'
  );
  return true;
}

/**
 * 只读检查 context-mode MCP server 是否存在且无需由本模块补齐。
 * 自定义 command 或 args 视为用户已配置；损坏或不完整的标准配置视为未配置。
 *
 * @param agentDir Pi Agent 用户级目录；默认使用 Pi 公共 API 解析的目录。
 * @returns MCP server 是否已经可保留原样使用。
 */
export async function isContextModeMcpConfigured(
  agentDir: string = getAgentDir()
): Promise<boolean> {
  const configPath = join(agentDir, CONTEXT_MODE_MCP_CONFIG_FILE);

  try {
    const root = JSON.parse(await readFile(configPath, 'utf8')) as unknown;
    if (!isJsonObject(root) || !isJsonObject(root.mcpServers)) {
      return false;
    }

    const server = root.mcpServers[CONTEXT_MODE_MCP_SERVER_NAME];
    if (!isJsonObject(server) || typeof server.command !== 'string' || server.command.length === 0) {
      return false;
    }

    if (
      server.command !== CONTEXT_MODE_MCP_SERVER_NAME ||
      Object.hasOwn(server, 'args')
    ) {
      return true;
    }

    return createManagedContextModeServer(agentDir, server) === undefined;
  } catch {
    return false;
  }
}

/**
 * 将 mcp.json 中 context-mode server 的存储环境应用到当前 Agent 进程。
 * Pi Package extension 与 MCP server 运行在不同加载路径中，extension 不会自动继承 server.env。
 * 调用方显式提供的进程环境优先，避免覆盖部署层配置。
 *
 * @param agentDir Pi Agent 用户级目录；默认使用 Pi 公共 API 解析的目录。
 * @param env 即将加载 Pi Runtime 并传递给子进程的环境。
 * @returns 是否至少应用了一个 context-mode 环境变量。
 */
export async function applyContextModeMcpEnvironment(
  agentDir: string = getAgentDir(),
  env: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  const configPath = join(agentDir, CONTEXT_MODE_MCP_CONFIG_FILE);

  try {
    const root = JSON.parse(await readFile(configPath, 'utf8')) as unknown;
    if (!isJsonObject(root) || !isJsonObject(root.mcpServers)) {
      return false;
    }

    const server = root.mcpServers[CONTEXT_MODE_MCP_SERVER_NAME];
    if (!isJsonObject(server) || !isJsonObject(server.env)) {
      return false;
    }

    let applied = false;
    for (const name of [CONTEXT_MODE_DATA_DIR_ENV, CONTEXT_MODE_DIR_ENV]) {
      const value = server.env[name];
      if (env[name] === undefined && typeof value === 'string' && value.trim().length > 0) {
        env[name] = value;
        applied = true;
      }
    }
    return applied;
  } catch {
    return false;
  }
}

/**
 * 创建新的标准 server，或为旧版标准 server 补齐 Dr.Octopus 存储目录变量。
 *
 * @param agentDir Pi Agent 用户级目录。
 * @param existingServer 当前同名 server 配置。
 * @returns 需要写入的配置；自定义配置或无需变化时返回 undefined。
 */
function createManagedContextModeServer(
  agentDir: string,
  existingServer: unknown
): Record<string, unknown> | undefined {
  const agentRoot = dirname(resolve(agentDir));
  const managedEnv = {
    [CONTEXT_MODE_DATA_DIR_ENV]: agentRoot,
    [CONTEXT_MODE_DIR_ENV]: join(agentRoot, CONTEXT_MODE_MCP_SERVER_NAME),
  };

  if (existingServer === undefined) {
    return {
      command: CONTEXT_MODE_MCP_SERVER_NAME,
      env: managedEnv,
    };
  }

  if (
    !isJsonObject(existingServer) ||
    existingServer.command !== CONTEXT_MODE_MCP_SERVER_NAME ||
    Object.hasOwn(existingServer, 'args')
  ) {
    return undefined;
  }

  const existingEnv = existingServer.env;
  if (existingEnv !== undefined && !isJsonObject(existingEnv)) {
    return undefined;
  }

  const nextEnv = { ...managedEnv, ...existingEnv };
  if (
    existingEnv?.[CONTEXT_MODE_DATA_DIR_ENV] === nextEnv[CONTEXT_MODE_DATA_DIR_ENV] &&
    existingEnv?.[CONTEXT_MODE_DIR_ENV] === nextEnv[CONTEXT_MODE_DIR_ENV]
  ) {
    return undefined;
  }

  return {
    ...existingServer,
    env: nextEnv,
  };
}

/**
 * 判断未知 JSON 值是否为可安全合并的普通对象。
 *
 * @param value 待验证的 JSON 值。
 * @returns value 是否为非数组对象。
 */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 判断未知异常是否携带指定的 Node.js error code。
 *
 * @param error 捕获到的未知异常。
 * @param code 期望的 Node.js error code。
 * @returns 异常是否匹配指定 code。
 */
function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}
