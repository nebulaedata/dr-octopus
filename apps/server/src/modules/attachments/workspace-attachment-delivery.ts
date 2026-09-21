/**
 * @author Codex
 * @description Delivers immutable attachment inputs and explicit output locations inside the selected Workspace only.
 */
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { ApplicationError } from '../../lib/errors/application-error.js';
import {
  ensureManagedDirectories,
  prepareWorkspaceAttachmentCacheRoot,
} from './workspace-attachment-cache-root.js';
import type {
  WorkspaceAttachmentCache,
  WorkspaceAttachmentCacheInput,
} from './workspace-attachment-cache.js';

type Artifact = Omit<WorkspaceAttachmentCacheInput, 'workspaceCwd'>;

/**
 * Fails delivery rather than exposing a Server fallback path when the Workspace is unavailable.
 * Hash-derived temporary directories avoid accepting session or attachment identifiers as paths.
 */
export async function deliverWorkspaceAttachment(
  cache: WorkspaceAttachmentCache,
  input: {
    workspaceCwd: string;
    sessionId: string;
    attachmentId: string;
    original: Artifact;
    extracted?: Artifact;
  }
): Promise<{
  originalPath: string;
  extractedPath?: string;
  outputDirectory: string;
  temporaryDirectory: string;
}> {
  try {
    const root = await realpath(input.workspaceCwd);
    const cacheRoot = await prepareWorkspaceAttachmentCacheRoot(root);
    const outputDirectory = join(root, 'output');
    await ensureManagedDirectories(root, outputDirectory);
    const key = createHash('sha256')
      .update(JSON.stringify([input.sessionId, input.attachmentId]))
      .digest('hex');
    const temporaryDirectory = join(cacheRoot, 'work', key);
    await ensureManagedDirectories(cacheRoot, temporaryDirectory);
    const original = await cache.materialize({ ...input.original, workspaceCwd: root });
    if (original.status !== 'ready') {
      throw new Error('Original could not be materialized.');
    }
    const extracted =
      input.extracted === undefined
        ? undefined
        : await cache.materialize({ ...input.extracted, workspaceCwd: root });
    if (extracted !== undefined && extracted.status !== 'ready') {
      throw new Error('Extracted document could not be materialized.');
    }
    return {
      originalPath: original.path,
      extractedPath: extracted?.path,
      outputDirectory,
      temporaryDirectory,
    };
  } catch {
    throw new ApplicationError(
      'ATTACHMENT_NOT_READY',
      '附件无法交付到工作区，请检查工作区权限或附件缓存目录；未使用工作区外路径。',
      {
        statusCode: 423,
        retryable: true,
      }
    );
  }
}
