/**
 * @author Codex
 * @description 解析 Octopus 自有 CLI 参数，并隔离需要透传给 Pi 的参数
 */
import type { WorkspaceSelector } from '../extensions/workspace/definitions/types.js';

const WORKSPACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ParsedOctopusArgs {
  workspaceSelector: WorkspaceSelector;
  piArgs: string[];
}

/**
 * @description 将命令行中的 Workspace 值转换为 id 或 slug selector。
 *
 * @param value `--workspace` 后提供的 Workspace id 或 slug。
 * @returns 可交给 Workspace Service 解析的 selector。
 */
function createWorkspaceSelector(value: string): WorkspaceSelector {
  if (value === 'general' || WORKSPACE_ID_PATTERN.test(value)) {
    return { id: value };
  }
  return { slug: value };
}

/**
 * @description 消费 `--workspace <id-or-slug>` 或 `--workspace=<id-or-slug>`，其余参数原样透传给 Pi。
 *
 * @param args 不包含 Node 可执行文件与脚本路径的命令行参数。
 * @returns 当前 Workspace selector 与清理后的 Pi 参数。
 * @throws 重复指定 Workspace 或未提供 Workspace 值时抛出参数错误。
 */
export function parseOctopusArgs(args: string[]): ParsedOctopusArgs {
  let workspaceValue: string | undefined;
  const piArgs: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) {
      continue;
    }
    if (argument === '--workspace') {
      const value = args[index + 1];
      if (value === undefined || value.length === 0 || value.startsWith('-')) {
        throw new Error('Usage: octopus --workspace <id-or-slug>');
      }
      if (workspaceValue !== undefined) {
        throw new Error('--workspace may only be specified once.');
      }
      workspaceValue = value;
      index += 1;
      continue;
    }
    if (argument.startsWith('--workspace=')) {
      const value = argument.slice('--workspace='.length);
      if (value.length === 0) {
        throw new Error('Usage: octopus --workspace <id-or-slug>');
      }
      if (workspaceValue !== undefined) {
        throw new Error('--workspace may only be specified once.');
      }
      workspaceValue = value;
      continue;
    }
    piArgs.push(argument);
  }

  const workspaceSelector: WorkspaceSelector =
    workspaceValue === undefined ? { id: 'general' } : createWorkspaceSelector(workspaceValue);

  return {
    workspaceSelector,
    piArgs,
  };
}

/**
 * 判断命令参数或环境配置是否请求离线启动。
 *
 * @param args 传递给 Pi CLI 的参数。
 * @returns 命令参数或既有环境变量是否声明离线模式。
 */
export function isOfflineRequested(args: readonly string[]): boolean {
  if (args.includes('--offline')) {
    return true;
  }

  return /^(1|true|yes)$/i.test(process.env.PI_OFFLINE ?? '');
}
