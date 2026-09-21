/**
 * @author Codex
 * @description Encapsulates safe Workspace-relative path resolution and filesystem error translation.
 */

import { readdir } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { ApplicationError } from '../../lib/errors/application-error.js';
import type { Dirent } from 'node:fs';
import type { WorkspaceDescriptor } from '@octopus/agent';
import type { WorkspaceDto } from '@octopus/shared/protocol';

/**
 * Removes trusted local paths before returning a Workspace to browsers,
 * except `cwd`, which the File Explorer UI needs to display and browse.
 *
 * @param workspace Trusted Workspace descriptor.
 * @returns Browser-safe Workspace representation.
 */
export function toWorkspaceDto(workspace: WorkspaceDescriptor): WorkspaceDto {
  return {
    id: workspace.id,
    kind: workspace.kind,
    name: workspace.name,
    ...(workspace.slug === undefined ? {} : { slug: workspace.slug }),
    cwd: workspace.cwd,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
}

/**
 * Reads a directory while translating infrastructure failures into stable application errors.
 *
 * @param absoluteDir Verified absolute directory path.
 * @returns Directory entries including their filesystem kinds.
 */
export async function readDirectorySafely(absoluteDir: string): Promise<Dirent[]> {
  try {
    return await readdir(absoluteDir, { withFileTypes: true });
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      throw new ApplicationError('WORKSPACE_FILE_NOT_FOUND', 'Workspace directory was not found.', {
        statusCode: 404,
        cause: error,
      });
    }
    throw new ApplicationError('WORKSPACE_FILE_LIST_FAILED', 'Unable to read Workspace directory.', {
      statusCode: 500,
      cause: error,
    });
  }
}

/**
 * Normalizes a browser-supplied relative path and rejects traversal segments.
 *
 * @param relativePath Untrusted Workspace-relative path.
 * @returns Normalized POSIX-style relative path.
 */
export function normalizeRelativePath(relativePath: string): string {
  const segments = relativePath
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === '..' || segment === '.')) {
    throw new ApplicationError('WORKSPACE_FILE_PATH_INVALID', 'Requested path is invalid.', {
      statusCode: 400,
    });
  }
  return segments.join('/');
}

/**
 * Resolves a normalized relative path and verifies it remains under the Workspace root.
 *
 * @param root Trusted Workspace root.
 * @param relativePath Normalized Workspace-relative path.
 * @returns Verified absolute path.
 */
export function resolveWithinRoot(root: string, relativePath: string): string {
  const absolute = resolve(root, ...relativePath.split('/').filter(Boolean));
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  if (absolute !== root && !absolute.startsWith(normalizedRoot)) {
    throw new ApplicationError('WORKSPACE_FILE_PATH_INVALID', 'Requested path is invalid.', {
      statusCode: 400,
    });
  }
  return absolute;
}

/**
 * Checks an unknown Node filesystem error for a stable error code.
 *
 * @param error Unknown thrown value.
 * @param code Expected Node error code.
 * @returns Whether the value exposes the expected code.
 */
export function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
