/**
 * @author Codex
 * @description 生成 Octopus 受管 Workspace 的固定路径布局
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CONFIG_DIR_NAME } from '@earendil-works/pi-coding-agent';
import type { WorkspacePaths } from '../definitions/types.js';

/**
 * @description 从 Octopus Root 生成所有 Workspace 受管路径。
 *
 * @param root Octopus 数据根目录，默认使用 @earendil-works/pi-coding-agent packages.json 中 configDir 字段指定的名称
 * 默认是 .pi, 但在 Octopus 中使用 pnpm patches 被重命名为 .dr-octopus
 * @returns 不依赖进程 cwd 的绝对路径集合。
 */
export function createWorkspacePaths(root = join(homedir(), CONFIG_DIR_NAME)): WorkspacePaths {
  const workspaces = join(root, 'workspaces');
  return {
    root,
    agent: join(root, 'agent'),
    general: join(root, 'general'),
    workspaces,
    registry: join(workspaces, 'index.json'),
  };
}
