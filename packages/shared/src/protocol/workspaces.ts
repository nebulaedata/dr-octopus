/**
 * @author Codex
 * @description Defines shared Workspace and Workspace file-tree protocol contracts.
 */

export interface WorkspaceDto {
  id: string;
  kind: 'general' | 'project';
  name: string;
  slug?: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
}

export type FileTreeEntryType = 'file' | 'directory';

export interface FileTreeEntryDto {
  name: string;
  /** Slash-separated path relative to the Workspace root. */
  path: string;
  type: FileTreeEntryType;
}
