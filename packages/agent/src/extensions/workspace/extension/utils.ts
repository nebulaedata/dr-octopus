/**
 * @author Codex
 * @description 提供 Workspace 只读 Extension 的共享查询与展示函数
 */
import { resolve } from 'node:path';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { WorkspaceDescriptor } from '../definitions/types.js';
import type { WorkspaceService } from '../definitions/port.js';

const WORKSPACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * @description 根据 Pi 提供的启动 cwd 查找当前 Workspace，避免读取可变的进程全局 cwd。
 */
export async function findCurrentWorkspace(
  service: WorkspaceService,
  cwd: string
): Promise<WorkspaceDescriptor | undefined> {
  const normalized = resolve(cwd);
  return (await service.list()).find((workspace) => resolve(workspace.cwd) === normalized);
}

/**
 * @description 将 Workspace Descriptor 格式化为适合终端展示的稳定文本。
 */
export function formatWorkspace(workspace: WorkspaceDescriptor): string {
  const selector = workspace.slug ?? workspace.id;
  return `${workspace.name} (${selector})\n${workspace.cwd}`;
}

/**
 * @description 在有交互 UI 时展示只读命令结果；非交互模式安全地不触发 UI。
 */
export function notifyWorkspaceResult(ctx: ExtensionContext, message: string): void {
  if (ctx.hasUI) {
    ctx.ui.notify(message, 'info');
  }
}

/**
 * @description 解析 create 子命令，将可含空格的名称与可选 slug 分离。
 *
 * @param args `create` 后的原始命令参数。
 * @returns Workspace Service 接受的创建命令。
 * @throws 名称缺失、slug 缺失或存在未知参数时抛出使用方法错误。
 */
export function parseCreateCommand(
  args: string,
  errMsg?: string
): { name: string; slug?: string; open: boolean } {
  const open = /(?:^|\s)--open(?:\s|$)/u.test(args);
  const withoutOpen = args.replace(/(?:^|\s)--open(?=\s|$)/gu, ' ').trim();
  const slugFlag = withoutOpen.indexOf(' --slug ');
  const nameSource = slugFlag === -1 ? withoutOpen : withoutOpen.slice(0, slugFlag);
  const slug = slugFlag === -1 ? undefined : withoutOpen.slice(slugFlag + ' --slug '.length).trim();
  const name = nameSource.trim().replace(/^(['"])(.*)\1$/, '$2');
  if (name.length === 0 || (slugFlag !== -1 && (slug === undefined || slug.length === 0))) {
    throw new Error(errMsg || 'Usage: /workspace create <name> [--slug <slug>]');
  }
  return slug === undefined ? { name, open } : { name, slug, open };
}

/**
 * @description 将 `/workspace open` 参数解析为稳定的 id 或 slug selector。
 */
export function parseWorkspaceSelector(value: string): { id?: string; slug?: string } {
  const selector = value.trim();
  if (selector.length === 0 || selector.includes(' ')) {
    throw new Error('Usage: /workspace open <id-or-slug>');
  }
  return selector === 'general' || WORKSPACE_ID_PATTERN.test(selector)
    ? { id: selector }
    : { slug: selector };
}
