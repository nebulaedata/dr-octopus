/**
 * @author GitHub Copilot
 * @description Defines the normalized, lazily-populated Workspace file tree cache contract.
 */

import type { FileTreeEntryDto, FileTreeEntryType } from '@octopus/shared/protocol';

export interface FileTreeNode {
  entry: FileTreeEntryDto;
  /** Ordered child paths once loaded; absent until the directory has been expanded. */
  childPaths?: string[];
  loaded: boolean;
  loading: boolean;
  error?: string;
}

export interface WorkspaceFileTreeState {
  rootPaths: string[];
  rootLoaded: boolean;
  rootLoading: boolean;
  rootError?: string;
  nodesByPath: Record<string, FileTreeNode>;
  /** Paths of the currently selected file or folder entries. */
  selectedPaths: string[];
  /** UI expansion state per directory path, decoupled from lazy-load caching. */
  expandedPaths: Record<string, boolean>;
}

export interface FileExplorerState {
  workspaces: Record<string, WorkspaceFileTreeState>;
}

export interface FileExplorerActions {
  /**
   * Loads the direct entries of a Workspace root; a no-op once already loaded or loading.
   */
  loadRoot(workspaceId: string): Promise<void>;
  /**
   * Lazily fetches a directory's direct children on first expansion; a no-op once cached.
   */
  expandDirectory(workspaceId: string, path: string): Promise<void>;
  /**
   * Re-fetches a directory's direct children regardless of cache state, for a local refresh.
   */
  reloadDirectory(workspaceId: string, path: string): Promise<void>;
  /**
   * Sets a directory's UI expansion flag without affecting its lazy-load cache.
   */
  setExpanded(workspaceId: string, path: string, expanded: boolean): void;
  /**
   * Selects the given entry path within a Workspace's file tree.
   * @param toggle - When true (e.g. Ctrl/Cmd+click), adds to or removes from the existing selection instead of replacing it.
   */
  selectPath(workspaceId: string, path: string, toggle?: boolean): void;
  /**
   * Creates an empty file or directory under `parentPath` (root when undefined) and inserts it into the cache.
   * @throws Error when an entry with the same name already exists among known siblings.
   */
  createEntry(
    workspaceId: string,
    parentPath: string | undefined,
    name: string,
    type: FileTreeEntryType
  ): Promise<void>;
  /**
   * Deletes the given entries (recursively for directories) and evicts them from the cache and selection.
   */
  deleteEntries(workspaceId: string, paths: string[]): Promise<void>;
  /**
   * Uploads the given files into `targetDir` (root when undefined), inserting each into the cache on success.
   */
  uploadFiles(workspaceId: string, targetDir: string | undefined, files: File[]): Promise<void>;
  /**
   * Clears the Workspace's lazy-load cache and reloads only the root with every directory collapsed.
   */
  refreshAll(workspaceId: string): Promise<void>;
  /**
   * Collapses every directory in a Workspace's tree without discarding the lazy-load cache.
   */
  collapseAll(workspaceId: string): void;
}

export type FileExplorerStore = FileExplorerState & FileExplorerActions;
