/**
 * @author Codex
 * @description 定义 Workspace 服务接口
 */

import type { CreateWorkspaceCommand, WorkspaceDescriptor, WorkspaceSelector } from './types.js';

export interface WorkspaceSessionBootstrapResult {
  sessionPath: string;
  cleanup(): Promise<void>;
}

export interface WorkspaceSessionBootstrap {
  /**
   * @description 使用 Pi Session 公开契约为目标 cwd 初始化只有合法 header 的持久化 Session。
   */
  create(
    cwd: string,
    current?: { cwd: string; sessionDir: string }
  ): Promise<WorkspaceSessionBootstrapResult>;
}

export interface WorkspaceService {
  /**
   * @description 列出 General 与所有已登记的 Project Workspace。
   */
  list(): Promise<WorkspaceDescriptor[]>;

  /**
   * @description 通过唯一 id 或 slug 解析 Workspace。
   */
  resolve(selector: WorkspaceSelector): Promise<WorkspaceDescriptor>;

  /**
   * @description 创建空的受管 Project Workspace。
   */
  create(command: CreateWorkspaceCommand): Promise<WorkspaceDescriptor>;
}
