/**
 * @author GitHub Copilot
 * @description Workspace 文件树 Store 的纯函数与状态更新辅助工具。
 */

import type { FileTreeEntryDto } from '@octopus/shared/protocol';
import type { FileExplorerState, FileTreeNode, WorkspaceFileTreeState } from './type';

/**
 * 创建空 Workspace 文件树投影。
 */
export function createEmptyWorkspaceState(): WorkspaceFileTreeState {
  return {
    rootPaths: [],
    rootLoaded: false,
    rootLoading: false,
    nodesByPath: {},
    selectedPaths: [],
    expandedPaths: {},
  };
}

/**
 * 把单层目录条目合并到路径索引，保留已加载的子目录缓存。
 */
export function flattenEntries(
  entries: FileTreeEntryDto[],
  nodesByPath: Record<string, FileTreeNode>
): string[] {
  const paths: string[] = [];
  for (const entry of entries) {
    paths.push(entry.path);
    const existing = nodesByPath[entry.path];
    const childPaths = existing?.childPaths;
    nodesByPath[entry.path] = {
      ...existing,
      entry,
      childPaths,
      loaded: entry.type === 'file' || childPaths !== undefined,
      loading: existing?.loading ?? false,
    };
  }
  return paths;
}

/**
 * 对指定 Workspace 状态应用更新，缺失时先创建空态。
 */
export function withWorkspace(
  state: FileExplorerState,
  workspaceId: string,
  update: (workspace: WorkspaceFileTreeState) => WorkspaceFileTreeState
): FileExplorerState {
  const workspace = state.workspaces[workspaceId] ?? createEmptyWorkspaceState();
  return { workspaces: { ...state.workspaces, [workspaceId]: update(workspace) } };
}

/**
 * 对指定路径的节点应用更新，缺失时保持原状态不变。
 */
export function withNode(
  state: FileExplorerState,
  workspaceId: string,
  path: string,
  update: (node: FileTreeNode) => FileTreeNode
): FileExplorerState {
  return withWorkspace(state, workspaceId, (workspace) => {
    const target = workspace.nodesByPath[path];
    if (target === undefined) {
      return workspace;
    }
    return { ...workspace, nodesByPath: { ...workspace.nodesByPath, [path]: update(target) } };
  });
}

/**
 * 把新建/上传得到的单个条目写入缓存，并挂到其父目录的 childPaths（或根路径列表）末尾。
 */
export function insertEntry(
  workspace: WorkspaceFileTreeState,
  parentPath: string | undefined,
  entry: FileTreeEntryDto
): WorkspaceFileTreeState {
  const nodesByPath = { ...workspace.nodesByPath };
  nodesByPath[entry.path] = {
    entry,
    childPaths: entry.type === 'directory' ? [] : undefined,
    loaded: true,
    loading: false,
  };
  if (parentPath === undefined) {
    const rootPaths = workspace.rootPaths.includes(entry.path)
      ? workspace.rootPaths
      : [...workspace.rootPaths, entry.path];
    return { ...workspace, rootPaths, nodesByPath };
  }
  const parent = nodesByPath[parentPath];
  if (parent !== undefined) {
    const childPaths = parent.childPaths ?? [];
    nodesByPath[parentPath] = childPaths.includes(entry.path)
      ? parent
      : { ...parent, childPaths: [...childPaths, entry.path] };
  }
  return { ...workspace, nodesByPath };
}

/**
 * 级联移除一批路径及其全部后代，并从根路径列表、父级 childPaths 与选中集合中摘除。
 */
export function removeEntries(workspace: WorkspaceFileTreeState, paths: string[]): WorkspaceFileTreeState {
  const toRemove = new Set<string>();
  const collectDescendants = (path: string): void => {
    if (toRemove.has(path)) {
      return;
    }
    toRemove.add(path);
    for (const childPath of workspace.nodesByPath[path]?.childPaths ?? []) {
      collectDescendants(childPath);
    }
  };
  for (const path of paths) {
    collectDescendants(path);
  }

  const nodesByPath = { ...workspace.nodesByPath };
  for (const path of toRemove) {
    delete nodesByPath[path];
  }
  for (const path of Object.keys(nodesByPath)) {
    const node = nodesByPath[path];
    if (node.childPaths?.some((childPath) => toRemove.has(childPath))) {
      nodesByPath[path] = {
        ...node,
        childPaths: node.childPaths.filter((childPath) => !toRemove.has(childPath)),
      };
    }
  }

  return {
    ...workspace,
    nodesByPath,
    rootPaths: workspace.rootPaths.filter((path) => !toRemove.has(path)),
    selectedPaths: workspace.selectedPaths.filter((path) => !toRemove.has(path)),
  };
}
