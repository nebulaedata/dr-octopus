/**
 * @author Codex
 * @description Projects registered Pi tool identities into the unattended authorization catalog.
 */
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import type { ToolInfo } from '@earendil-works/pi-coding-agent';
import type { TaskToolCapability, TaskToolCatalogEntry } from '@octopus/shared/protocol/scheduled-tasks';
import type { PermissionPolicy } from '../definitions/types.js';

/**
 * Exclude interactive, delegation, authorization control and self-modifying tools; remaining ctx tools require explicit full capability grants.
 */
export function eligible(name: string): boolean {
  return !/scheduler|permission|subagent|bg_wait|ask_user|plan_mode|user_bash|ctx_upgrade/i.test(name);
}

/**
 * Bind exact tool schema and provider provenance, withholding raw source paths from the user catalog.
 */
export function capability(tool: ToolInfo): TaskToolCapability {
  return {
    name: tool.name,
    identity: createHash('sha256')
      .update(JSON.stringify([tool.name, tool.sourceInfo, tool.parameters, tool.description]))
      .digest('hex'),
    description: tool.description.slice(0, 4000),
  };
}

/**
 * Apply mandatory policy to the current registered tools; this function never initializes providers.
 */
export function createUnattendedToolCatalog(
  tools: ToolInfo[],
  policy: PermissionPolicy
): TaskToolCatalogEntry[] {
  return tools
    .filter((tool) => eligible(tool.name))
    .map((tool) => {
      const rule = policy.tools[tool.name];
      const info = tool.sourceInfo;
      return {
        ...capability(tool),
        source: (info?.source?.startsWith('npm:')
          ? info.source
          : info
            ? `${info.scope} / ${basename(info.path)}`
            : '内置工具'
        ).slice(0, 500),
        unavailableReason:
          rule === 'deny'
            ? '当前权限策略禁止此工具（deny）'
            : rule === 'ask'
              ? '当前权限策略要求逐次人工确认（ask），不可用于无人值守授权'
              : null,
      };
    });
}
