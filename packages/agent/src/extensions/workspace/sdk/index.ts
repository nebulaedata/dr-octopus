/**
 * @author Codex
 * @description 对外扎口 Workspace Service、稳定契约与默认路径工厂
 */

import { createWorkspacePaths } from '../lib/workspace-paths.js';
import { WorkspaceManagerService } from '../services/workspace-manager-service.js';
import { PiWorkspaceSessionBootstrap } from '../lib/pi-workspace-session-bootstrap.js';

export { createWorkspacePaths } from '../lib/workspace-paths.js';
export type { WorkspaceDescriptor, WorkspaceSelector } from '../definitions/types.js';
export type { WorkspaceSessionBootstrap, WorkspaceSessionBootstrapResult } from '../definitions/port.js';

/**
 * @description 创建使用 Pi 公共 Session API的 Workspace Session bootstrap。
 */
export function createWorkspaceSessionBootstrap(): PiWorkspaceSessionBootstrap {
  return new PiWorkspaceSessionBootstrap();
}

export function createWorkspaceService(root?: string): WorkspaceManagerService {
  return new WorkspaceManagerService(createWorkspacePaths(root));
}
