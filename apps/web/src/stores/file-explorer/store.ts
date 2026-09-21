/**
 * @author GitHub Copilot
 * @description 维护 Workspace 文件树的懒加载缓存：首次只加载根目录，展开时再按需加载；同时支撑增删改与展开态管理。
 */

import { create } from 'zustand';
import { combine } from 'zustand/middleware';
import {
  createWorkspaceFileEntry,
  deleteWorkspaceFileEntries,
  getWorkspaceFileTree,
  uploadWorkspaceFile,
} from '@/api/workspace';
import { flattenEntries, insertEntry, removeEntries, withNode, withWorkspace } from './utils';
import type { FileExplorerActions, FileExplorerState } from './type';

export const useFileExplorerStore = create(
  combine<FileExplorerState, FileExplorerActions>({ workspaces: {} }, (set, get) => {
    const generations = new Map<string, number>();
    /**
     * 拉取单个目录的直接子项并写入缓存，供首次展开与强制刷新共用。
     */
    async function fetchDirectoryChildren(workspaceId: string, path: string): Promise<void> {
      const generation = generations.get(workspaceId) ?? 0;
      set((state) => withNode(state, workspaceId, path, (target) => ({ ...target, loading: true })));
      try {
        const entries = await getWorkspaceFileTree(workspaceId, path);
        if (
          (generations.get(workspaceId) ?? 0) !== generation ||
          !get().workspaces[workspaceId]?.nodesByPath[path]
        ) {
          return;
        }
        set((state) =>
          withWorkspace(state, workspaceId, (workspace) => {
            const nodesByPath = { ...workspace.nodesByPath };
            const childPaths = flattenEntries(entries, nodesByPath);
            nodesByPath[path] = {
              ...nodesByPath[path],
              childPaths,
              loaded: true,
              loading: false,
              error: undefined,
            };
            return { ...workspace, nodesByPath };
          })
        );
      } catch (error) {
        if ((generations.get(workspaceId) ?? 0) !== generation) {
          return;
        }
        set((state) =>
          withNode(state, workspaceId, path, (target) => ({
            ...target,
            loading: false,
            error: error instanceof Error ? error.message : 'Failed to load directory.',
          }))
        );
      }
    }

    /**
     * 只加载 Workspace 根目录的直接子项；已加载或加载中时为空操作。
     */
    async function loadRoot(workspaceId: string): Promise<void> {
      const generation = generations.get(workspaceId) ?? 0;
      const current = get().workspaces[workspaceId];
      if (current?.rootLoaded || current?.rootLoading) {
        return;
      }
      set((state) => withWorkspace(state, workspaceId, (workspace) => ({ ...workspace, rootLoading: true })));
      try {
        const entries = await getWorkspaceFileTree(workspaceId, '');
        if ((generations.get(workspaceId) ?? 0) !== generation) {
          return;
        }
        set((state) =>
          withWorkspace(state, workspaceId, (workspace) => {
            const nodesByPath = { ...workspace.nodesByPath };
            const rootPaths = flattenEntries(entries, nodesByPath);
            return {
              ...workspace,
              rootPaths,
              rootLoaded: true,
              rootLoading: false,
              rootError: undefined,
              nodesByPath,
            };
          })
        );
      } catch (error) {
        if ((generations.get(workspaceId) ?? 0) !== generation) {
          return;
        }
        set((state) =>
          withWorkspace(state, workspaceId, (workspace) => ({
            ...workspace,
            rootLoading: false,
            rootError: error instanceof Error ? error.message : 'Failed to load Workspace files.',
          }))
        );
      }
    }

    /**
     * 无视缓存状态强制重新拉取一个目录的直接子项，供局部刷新复用。
     */
    async function reloadDirectory(workspaceId: string, path: string): Promise<void> {
      const node = get().workspaces[workspaceId]?.nodesByPath[path];
      if (node === undefined || node.entry.type !== 'directory' || node.loading) {
        return;
      }
      await fetchDirectoryChildren(workspaceId, path);
    }

    /**
     * 写入目录的 UI 展开标记，不影响其懒加载缓存。
     */
    function setExpanded(workspaceId: string, path: string, expanded: boolean): void {
      set((state) =>
        withWorkspace(state, workspaceId, (workspace) => ({
          ...workspace,
          expandedPaths: { ...workspace.expandedPaths, [path]: expanded },
        }))
      );
    }

    return {
      loadRoot,

      async expandDirectory(workspaceId, path) {
        const node = get().workspaces[workspaceId]?.nodesByPath[path];
        if (node === undefined || node.entry.type !== 'directory' || node.loaded || node.loading) {
          return;
        }
        await fetchDirectoryChildren(workspaceId, path);
      },

      reloadDirectory,
      setExpanded,

      selectPath(workspaceId, path, toggle) {
        set((state) =>
          withWorkspace(state, workspaceId, (workspace) => {
            if (!toggle) {
              return { ...workspace, selectedPaths: [path] };
            }
            const selectedPaths = workspace.selectedPaths.includes(path)
              ? workspace.selectedPaths.filter((selectedPath) => selectedPath !== path)
              : [...workspace.selectedPaths, path];
            return { ...workspace, selectedPaths };
          })
        );
      },

      async createEntry(workspaceId, parentPath, name, type) {
        const path = parentPath ? `${parentPath}/${name}` : name;
        const entry = await createWorkspaceFileEntry(workspaceId, path, type);
        set((state) =>
          withWorkspace(state, workspaceId, (workspace) => insertEntry(workspace, parentPath, entry))
        );
      },

      async deleteEntries(workspaceId, paths) {
        await deleteWorkspaceFileEntries(workspaceId, paths);
        set((state) => withWorkspace(state, workspaceId, (workspace) => removeEntries(workspace, paths)));
      },

      async uploadFiles(workspaceId, targetDir, files) {
        for (const file of files) {
          const entry = await uploadWorkspaceFile(workspaceId, targetDir ?? '', file);
          set((state) =>
            withWorkspace(state, workspaceId, (workspace) => insertEntry(workspace, targetDir, entry))
          );
        }
      },

      async refreshAll(workspaceId) {
        generations.set(workspaceId, (generations.get(workspaceId) ?? 0) + 1);
        set((state) => ({
          workspaces: {
            ...state.workspaces,
            [workspaceId]: {
              rootPaths: [],
              rootLoaded: false,
              rootLoading: false,
              nodesByPath: {},
              selectedPaths: [],
              expandedPaths: {},
            },
          },
        }));
        await loadRoot(workspaceId);
      },

      collapseAll(workspaceId) {
        set((state) =>
          withWorkspace(state, workspaceId, (workspace) => ({
            ...workspace,
            expandedPaths: {},
            selectedPaths: [],
          }))
        );
      },
    } satisfies FileExplorerActions;
  })
);
