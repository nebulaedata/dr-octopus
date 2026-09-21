/**
 * @author Codex
 * @description 定义 Workspace 相关的类型、接口与错误码
 */

export const WORKSPACE_ERROR_CODES = [
  'WORKSPACE_NOT_FOUND',
  'WORKSPACE_SELECTOR_INVALID',
  'WORKSPACE_SELECTOR_AMBIGUOUS',
  'WORKSPACE_ALREADY_EXISTS',
  'WORKSPACE_REGISTRY_CORRUPT',
  'WORKSPACE_PATH_VIOLATION',
  'WORKSPACE_CREATE_FAILED',
] as const;

export type WorkspaceErrorCode = (typeof WORKSPACE_ERROR_CODES)[number];

export interface WorkspaceDescriptor {
  schemaVersion: 1;
  id: string;
  kind: 'general' | 'project';
  name: string;
  slug?: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceSelector {
  id?: string;
  slug?: string;
}

export interface CreateWorkspaceCommand {
  name: string;
  slug?: string;
}

export interface WorkspacePaths {
  root: string;
  agent: string;
  general: string;
  workspaces: string;
  registry: string;
}
