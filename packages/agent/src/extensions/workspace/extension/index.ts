/**
 * @author Codex
 * @description 组合并默认导出 Workspace 只读 Pi InlineExtension
 */
import { registerWorkspaceCommand } from './commands.js';
import { registerWorkspaceEvents } from './events.js';
import { registerWorkspaceTool } from './tools.js';
import { createWorkspaceService, createWorkspaceSessionBootstrap } from '../sdk/index.js';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { WorkspaceSessionBootstrap } from '../definitions/port.js';
import type { WorkspaceService } from '../definitions/port.js';

const workspaceService = createWorkspaceService();
const workspaceSessionBootstrap = createWorkspaceSessionBootstrap();

/**
 * @description 注册 Workspace 的只读工具、命令 surface 与资源发现事件。
 */
export default function workspaceExtension(pi: ExtensionAPI): void {
  registerWorkspaceEvents(pi);
  registerWorkspaceTool(pi, workspaceService);
  registerWorkspaceCommand(pi, workspaceService, workspaceSessionBootstrap);
}

/**
 * @description 创建一个 Workspace 扩展工厂函数，返回一个可注册的 Pi InlineExtension
 * @param workspaceService
 * @returns
 */
export function createWorkspaceExtension(
  _workspaceService: WorkspaceService = workspaceService,
  _sessionBootstrap: WorkspaceSessionBootstrap = workspaceSessionBootstrap
) {
  return (pi: ExtensionAPI) => {
    registerWorkspaceEvents(pi);
    registerWorkspaceTool(pi, _workspaceService);
    registerWorkspaceCommand(pi, _workspaceService, _sessionBootstrap);
  };
}
