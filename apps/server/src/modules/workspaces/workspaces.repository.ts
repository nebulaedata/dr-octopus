/**
 * @author Codex
 * @description Resolves untrusted Composer references against canonical Workspace filesystem identity.
 */
import { lstat, realpath, stat, readdir } from 'node:fs/promises';
export { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { ApplicationError } from '../../infrastructure/errors/application-error.js';
import { hasErrorCode, normalizeRelativePath, resolveWithinRoot } from './workspaces.utils.js';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import type { Dirent } from 'node:fs';
import type { WorkspaceReferenceDto } from '@octopus/shared/protocol';

/**
 * Reads a bounded real image inside a workspace without following links outside its root.
 */
export async function readWorkspaceImage(root: string, path: string) {
  const canonicalRoot = await realpath(root);
  const target = await realpath(resolveWithinRoot(root, normalizeRelativePath(path)));
  const suffix = relative(canonicalRoot, target);
  if (isAbsolute(suffix) || suffix === '..' || suffix.startsWith(`..${sep}`)) {
    throw new ApplicationError('WORKSPACE_FILE_PATH_INVALID', 'Requested path is invalid.', {
      statusCode: 400,
    });
  }
  const info = await stat(target);
  if (!info.isFile() || info.size > 32 * 1024 * 1024) {
    throw new ApplicationError('WORKSPACE_IMAGE_UNSUPPORTED', 'The image is unavailable or unsupported.', {
      statusCode: 415,
    });
  }
  const bytes = await readFile(target);
  if (bytes.length > 32 * 1024 * 1024) {
    throw new ApplicationError('WORKSPACE_IMAGE_UNSUPPORTED', 'The image is unavailable or unsupported.', {
      statusCode: 415,
    });
  }
  try {
    const image = sharp(bytes, { limitInputPixels: 40_000_000 });
    const metadata = await image.metadata();
    if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1) {
      throw new Error('Unsupported image');
    }
    await image.stats();
    return { bytes, mimeType: `image/${metadata.format}` };
  } catch (cause) {
    throw new ApplicationError('WORKSPACE_IMAGE_UNSUPPORTED', 'The image is unavailable or unsupported.', {
      statusCode: 415,
      cause,
    });
  }
}

/**
 * Resolves, validates, normalizes, and de-duplicates Workspace references.
 *
 * @param workspaceRoot Trusted Workspace root.
 * @param references Untrusted Browser-selected references.
 * @returns Validated Workspace-relative references in first-occurrence order.
 */
export async function resolveWorkspaceReferenceSelection(
  workspaceRoot: string,
  references: readonly WorkspaceReferenceDto[]
): Promise<WorkspaceReferenceDto[]> {
  if (references.length === 0) {
    return [];
  }
  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(workspaceRoot);
  } catch (error) {
    throw new ApplicationError(
      'WORKSPACE_REFERENCE_RESOLUTION_FAILED',
      'Unable to resolve the Workspace root.',
      { statusCode: 500, cause: error }
    );
  }

  const resolved: WorkspaceReferenceDto[] = [];
  const seen = new Set<string>();
  for (const reference of references) {
    const normalized = await resolveReference(canonicalRoot, reference);
    const key = `${normalized.kind}:${normalized.path}`;
    if (!seen.has(key)) {
      seen.add(key);
      resolved.push(normalized);
    }
  }
  return resolved;
}

/**
 * Verifies one normalized reference against canonical filesystem identity and kind.
 *
 * @param canonicalRoot Canonical Workspace root.
 * @param reference Browser-supplied Workspace reference.
 * @returns Safe relative reference suitable for model prompt projection.
 */
async function resolveReference(
  canonicalRoot: string,
  reference: WorkspaceReferenceDto
): Promise<WorkspaceReferenceDto> {
  if (isAbsolute(reference.path) || reference.path.includes('\0')) {
    throw new ApplicationError('WORKSPACE_REFERENCE_PATH_INVALID', 'Workspace reference path is invalid.', {
      statusCode: 400,
    });
  }
  const safeRelative = normalizeRelativePath(reference.path);
  if (safeRelative.length === 0) {
    throw new ApplicationError('WORKSPACE_REFERENCE_PATH_INVALID', 'Workspace reference path is invalid.', {
      statusCode: 400,
    });
  }
  const absolutePath = resolveWithinRoot(canonicalRoot, safeRelative);
  try {
    const directStats = await lstat(absolutePath);
    if (directStats.isSymbolicLink()) {
      throw new ApplicationError(
        'WORKSPACE_REFERENCE_OUTSIDE_ROOT',
        'Symbolic links cannot be selected as Workspace references.',
        { statusCode: 400 }
      );
    }
    const canonicalTarget = await realpath(absolutePath);
    const targetRelative = relative(canonicalRoot, canonicalTarget);
    if (targetRelative === '..' || targetRelative.startsWith(`..${sep}`) || isAbsolute(targetRelative)) {
      throw new ApplicationError(
        'WORKSPACE_REFERENCE_OUTSIDE_ROOT',
        'Workspace reference resolves outside the Workspace.',
        { statusCode: 400 }
      );
    }
    const targetStats = await stat(canonicalTarget);
    let kind: 'directory' | 'file' | undefined;
    if (targetStats.isDirectory()) {
      kind = 'directory';
    } else if (targetStats.isFile()) {
      kind = 'file';
    }
    if (kind !== reference.kind) {
      throw new ApplicationError(
        'WORKSPACE_REFERENCE_KIND_MISMATCH',
        'Workspace reference kind no longer matches the selected entry.',
        { statusCode: 409 }
      );
    }
    return { path: safeRelative, kind };
  } catch (error) {
    if (error instanceof ApplicationError) {
      throw error;
    }
    if (hasErrorCode(error, 'ENOENT')) {
      throw new ApplicationError(
        'WORKSPACE_REFERENCE_STALE',
        'A selected Workspace reference no longer exists.',
        { statusCode: 409, cause: error }
      );
    }
    throw new ApplicationError(
      'WORKSPACE_REFERENCE_RESOLUTION_FAILED',
      'Unable to resolve a selected Workspace reference.',
      { statusCode: 500, cause: error }
    );
  }
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
