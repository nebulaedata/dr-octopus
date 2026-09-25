/**
 * @author Codex
 * @description Defines HTTP operations for Workspace resources and file management.
 */

import { readAsDataUrl } from '../utils/common';
import { request } from '../utils/request';
import type { FileTreeEntryDto, FileTreeEntryType, WorkspaceDto } from '@octopus/shared/protocol';

/**
 * Retrieves the Workspace catalog visible to the current Web client.
 *
 * @param signal Optional cancellation signal supplied by the query layer.
 */
export function getWorkspaces(signal?: AbortSignal): Promise<WorkspaceDto[]> {
  return request({
    url: '/workspaces',
    method: 'GET',
    signal,
  });
}

/**
 * Creates a trusted Workspace scoped to the current Server host.
 *
 * @param input Display name and optional slug for the new Workspace.
 */
export function createWorkspace(input: { name: string; slug?: string }): Promise<WorkspaceDto> {
  return request({
    url: '/workspaces',
    method: 'POST',
    data: input,
  });
}

/**
 * Retrieves the direct children of a Workspace directory, without probing descendants.
 *
 * @param workspaceId Target Workspace identifier.
 * @param path Slash-separated path relative to the Workspace root; empty string means the root.
 * @param signal Optional cancellation signal supplied by the query layer.
 */
export function getWorkspaceFileTree(
  workspaceId: string,
  path: string,
  signal?: AbortSignal
): Promise<FileTreeEntryDto[]> {
  return request<{ entries: FileTreeEntryDto[] }>({
    url: `/workspaces/${encodeURIComponent(workspaceId)}/files`,
    method: 'GET',
    params: { path },
    signal,
  }).then((response) => response.entries);
}

/**
 * Creates an empty file or directory at the given path within a Workspace.
 *
 * @param workspaceId Target Workspace identifier.
 * @param path Slash-separated path (including the new entry name) relative to the Workspace root.
 * @param type Whether to create a file or a directory.
 */
export function createWorkspaceFileEntry(
  workspaceId: string,
  path: string,
  type: FileTreeEntryType
): Promise<FileTreeEntryDto> {
  return request<{ entry: FileTreeEntryDto }>({
    url: `/workspaces/${encodeURIComponent(workspaceId)}/files`,
    method: 'POST',
    data: { path, type },
  }).then((response) => response.entry);
}

/**
 * Deletes one or more files or directories (recursively) from a Workspace.
 *
 * @param workspaceId Target Workspace identifier.
 * @param paths Slash-separated paths relative to the Workspace root.
 */
export function deleteWorkspaceFileEntries(workspaceId: string, paths: string[]): Promise<void> {
  return request<{ deleted: string[] }>({
    url: `/workspaces/${encodeURIComponent(workspaceId)}/files`,
    method: 'DELETE',
    data: { paths },
  }).then(() => undefined);
}

/**
 * Uploads a browser File into a target Workspace directory as a Base64 payload.
 *
 * @param workspaceId Target Workspace identifier.
 * @param targetDir Slash-separated destination directory path; empty string means the root.
 * @param file File selected by the user.
 */
export async function uploadWorkspaceFile(
  workspaceId: string,
  targetDir: string,
  file: File
): Promise<FileTreeEntryDto> {
  const dataUrl = await readAsDataUrl(file);
  return request<{ entry: FileTreeEntryDto }>({
    url: `/workspaces/${encodeURIComponent(workspaceId)}/files/upload`,
    method: 'POST',
    data: {
      path: targetDir,
      name: file.name,
      data: dataUrl.split(',', 2)[1] ?? '',
    },
  }).then((response) => response.entry);
}

/**
 * Builds the same-origin URL that streams a Workspace entry download (a zip for directories).
 *
 * @param workspaceId Target Workspace identifier.
 * @param path Slash-separated path relative to the Workspace root.
 */
export function getWorkspaceFileDownloadUrl(workspaceId: string, path: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/files/download?path=${encodeURIComponent(path)}`;
}

/**
 * Builds the same-origin URL for a validated, inline Workspace image.
 *
 * @param workspaceId Target Workspace identifier.
 * @param path Slash-separated image path relative to the Workspace root.
 */
export function getWorkspaceFileImageUrl(workspaceId: string, path: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/files/image?path=${encodeURIComponent(path)}`;
}

/**
 * Reads one Workspace text file for editing.
 *
 * @param workspaceId Target Workspace identifier.
 * @param path Slash-separated file path relative to the Workspace root.
 * @param signal Optional cancellation signal supplied by the query layer.
 */
export function getWorkspaceFileContent(
  workspaceId: string,
  path: string,
  signal?: AbortSignal
): Promise<string> {
  return request<{ content: string }>({
    url: `/workspaces/${encodeURIComponent(workspaceId)}/files/content`,
    method: 'GET',
    params: { path },
    signal,
  }).then((response) => response.content);
}

/**
 * Replaces one Workspace text file with the provided UTF-8 content.
 *
 * @param workspaceId Target Workspace identifier.
 * @param path Slash-separated file path relative to the Workspace root.
 * @param content Complete text to persist.
 */
export function updateWorkspaceFileContent(
  workspaceId: string,
  path: string,
  content: string
): Promise<void> {
  return request<{ saved: true }>({
    url: `/workspaces/${encodeURIComponent(workspaceId)}/files/content`,
    method: 'PUT',
    data: { path, content },
  }).then(() => undefined);
}
