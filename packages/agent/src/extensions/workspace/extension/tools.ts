/**
 * @author Codex
 * @description 注册读取当前 Workspace 的 Pi 模型工具
 */
import { Type } from 'typebox';
import { findCurrentWorkspace, formatWorkspace } from './utils.js';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { WorkspaceService } from '../definitions/port.js';

/**
 * @description 注册不包含任何 mutation 能力的 workspace_current 工具。
 *
 * @param pi 当前 Pi Extension API。
 * @param service 只读查询使用的 Workspace Service。
 */
export function registerWorkspaceTool(pi: ExtensionAPI, service: WorkspaceService): void {
  pi.registerTool({
    name: 'workspace_current',
    label: 'Current Workspace',
    description:
      'Return the current Octopus Workspace selected before this Pi process started. This tool is read-only.',
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const workspace = await findCurrentWorkspace(service, ctx.cwd);
      if (workspace === undefined) {
        throw new Error('The current cwd is not a managed Octopus Workspace.');
      }
      return {
        content: [{ type: 'text', text: formatWorkspace(workspace) }],
        details: { workspace },
      };
    },
  });
}
