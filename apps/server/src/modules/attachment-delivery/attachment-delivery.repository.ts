/**
 * @author root
 * @description Publishes verified attachment artifacts into a permanent content-addressed Workspace cache.
 */

import { ApplicationError } from '../../infrastructure/errors/application-error.js';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, rename, rm } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { CONFIG_DIR_NAME } from '@earendil-works/pi-coding-agent';
import { execFile } from 'node:child_process';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { LocalFileBlobStore } from '../../infrastructure/attachment-storage/local-file-blob-store.js';

export type WorkspaceAttachmentCacheResult =
  { status: 'ready'; path: string } | { status: 'unavailable'; reason: string };

export interface WorkspaceAttachmentCacheInput {
  workspaceCwd: string;
  storageKey: string;
  artifactSha256: string;
  kind: 'original' | 'document-json';
  filename: string;
}

/**
 * Owns safe creation, validation, and repair of permanent Workspace attachment cache entries.
 */
export class WorkspaceAttachmentCache {
  /**
   * @param blobs Immutable Server artifact authority used to reconstruct cache entries.
   */
  public constructor(private readonly blobs: LocalFileBlobStore) {}

  /**
   * Publishes or reuses one verified content-addressed artifact below the fixed Workspace cache.
   *
   * @param input Trusted artifact identity and Workspace selected by the Host Session.
   * @returns A ready Workspace path or a stable reason that the cache is unavailable.
   */
  public async materialize(input: WorkspaceAttachmentCacheInput): Promise<WorkspaceAttachmentCacheResult> {
    try {
      assertSha256(input.artifactSha256);
      const root = await prepareWorkspaceAttachmentCacheRoot(input.workspaceCwd);
      const filename =
        input.kind === 'document-json' ? 'document.json' : `original${safeExtension(input.filename)}`;
      const target = join(
        root,
        'sha256',
        input.artifactSha256.slice(0, 2),
        input.artifactSha256.slice(2, 4),
        input.artifactSha256,
        input.kind,
        filename
      );
      await ensureManagedDirectories(root, dirname(target));
      const existing = await inspectRegularFile(target);
      if (existing !== undefined && existing.sha256 === input.artifactSha256 && existing.byteSize > 0) {
        return { status: 'ready', path: target };
      }
      await this.#publish(input.storageKey, target, input.artifactSha256);
      return { status: 'ready', path: target };
    } catch (error) {
      return { status: 'unavailable', reason: cacheFailureReason(error) };
    }
  }

  /**
   * Streams one authoritative artifact through a verified temporary file before atomic publication.
   *
   * @param storageKey Server BlobStore key for the selected artifact.
   * @param target Final content-addressed Workspace path.
   * @param expectedSha256 Expected artifact checksum from Server metadata.
   */
  async #publish(storageKey: string, target: string, expectedSha256: string): Promise<void> {
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await pipeline(
        (await this.blobs.openRead(storageKey)).stream,
        createWriteStream(temporary, { flags: 'wx', mode: 0o600 })
      );
      const inspected = await inspectRegularFile(temporary);
      if (inspected === undefined || inspected.sha256 !== expectedSha256) {
        throw new Error('Workspace attachment cache publication checksum did not match.');
      }
      const current = await lstatIfExists(target);
      if (current?.isSymbolicLink() === true || (current !== undefined && !current.isFile())) {
        throw new Error('Workspace attachment cache target is not a regular file.');
      }
      if (current !== undefined) {
        await rm(target, { force: true });
      }
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}

/**
 * Inspects a regular file with a streaming checksum and rejects links or special files.
 *
 * @param path Candidate cache file.
 * @returns File checksum and size, or undefined when the path does not exist.
 */
async function inspectRegularFile(path: string): Promise<{ sha256: string; byteSize: number } | undefined> {
  const metadata = await lstatIfExists(path);
  if (metadata === undefined) {
    return undefined;
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error('Workspace attachment cache entry is not a regular file.');
  }
  const hash = createHash('sha256');
  let byteSize = 0;
  for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) {
    hash.update(chunk);
    byteSize += chunk.length;
  }
  return { sha256: hash.digest('hex'), byteSize };
}

/**
 * Reads link-aware metadata without treating a missing path as an infrastructure failure.
 *
 * @param path Candidate filesystem path.
 * @returns Link-aware metadata or undefined for ENOENT.
 */
async function lstatIfExists(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Validates a lowercase hexadecimal SHA-256 identity before using it in a path.
 *
 * @param value Candidate digest.
 */
function assertSha256(value: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error('Workspace attachment cache requires a valid SHA-256 identity.');
  }
}

/**
 * Produces a bounded normalized extension while keeping cache identity independent of display names.
 *
 * @param value Original display filename.
 * @returns Safe lowercase extension including the leading dot.
 */
function safeExtension(value: string): string {
  const extension = extname(basename(value)).toLowerCase();
  return /^\.[a-z0-9]{1,16}$/u.test(extension) ? extension : '.bin';
}

/**
 * Extracts a concise stable cache failure reason without leaking infrastructure details into prompts.
 *
 * @param error Unknown cache preparation failure.
 * @returns Stable diagnostic text.
 */
function cacheFailureReason(error: unknown): string {
  return error instanceof Error ? error.message : 'Workspace attachment cache is unavailable.';
}

/**
 * Checks an unknown Node error for one stable code.
 *
 * @param error Unknown thrown value.
 * @param code Expected Node error code.
 * @returns Whether the error exposes the expected code.
 */
function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

const execFileAsync = promisify(execFile);
const CACHE_RELATIVE_SEGMENTS = [CONFIG_DIR_NAME, 'temp', 'attachments'] as const;
const GITIGNORE_CONTENT = '*';

/**
 * Creates and validates the Host-owned cache root for one Workspace.
 *
 * @param workspaceCwd Workspace root resolved by Host authority.
 * @returns Canonical permanent attachment cache root.
 */
export async function prepareWorkspaceAttachmentCacheRoot(workspaceCwd: string): Promise<string> {
  const workspaceRoot = await realpath(resolve(workspaceCwd));
  const tempRoot = join(workspaceRoot, CONFIG_DIR_NAME, 'temp');
  await ensureManagedDirectories(workspaceRoot, tempRoot);
  await assertGitPathIsUntracked(workspaceRoot);
  await ensureSelfIgnoringGitignore(tempRoot);
  const attachmentsRoot = join(workspaceRoot, ...CACHE_RELATIVE_SEGMENTS);
  await ensureManagedDirectories(workspaceRoot, attachmentsRoot);
  const cacheRoot = await realpath(attachmentsRoot);
  assertContained(workspaceRoot, cacheRoot);
  return cacheRoot;
}

/**
 * Creates every missing directory between a trusted root and target while rejecting link traversal.
 *
 * @param root Existing trusted root directory.
 * @param target Descendant directory that must be created and validated.
 */
export async function ensureManagedDirectories(root: string, target: string): Promise<void> {
  assertContained(root, target);
  const pathSegments = relative(root, target)
    .split(/[\\/]+/u)
    .filter(Boolean);
  let current = root;
  for (const segment of pathSegments) {
    current = join(current, segment);
    try {
      await mkdir(current, { mode: 0o700 });
    } catch (error) {
      if (!hasErrorCode(error, 'EEXIST')) {
        throw error;
      }
    }
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error('Workspace attachment cache path contains a filesystem link or non-directory.');
    }
  }
  const canonicalTarget = await realpath(target);
  assertContained(await realpath(root), canonicalTarget);
}

/**
 * Ensures the Host-managed temp directory ignores all contents, including its own ignore file.
 *
 * @param tempRoot Canonical Workspace temp directory.
 */
async function ensureSelfIgnoringGitignore(tempRoot: string): Promise<void> {
  const path = join(tempRoot, '.gitignore');
  const existing = await lstatIfExists(path);
  if (existing === undefined) {
    try {
      await writeFile(path, GITIGNORE_CONTENT, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      return;
    } catch (error) {
      if (!hasErrorCode(error, 'EEXIST')) {
        throw error;
      }
    }
  } else if (existing.isSymbolicLink() || !existing.isFile()) {
    throw new Error('Workspace temp .gitignore is not a regular file.');
  }
  if ((await readFile(path, 'utf8')).trim() !== GITIGNORE_CONTENT) {
    throw new Error('Workspace temp .gitignore conflicts with the Octopus cache contract.');
  }
}

/**
 * Rejects a cache root that already contains Git-tracked paths without requiring Git for non-repositories.
 *
 * @param workspaceRoot Canonical Workspace root.
 */
async function assertGitPathIsUntracked(workspaceRoot: string): Promise<void> {
  try {
    const result = await execFileAsync(
      'git',
      ['--literal-pathspecs', '-C', workspaceRoot, 'ls-files', '--', `${CONFIG_DIR_NAME}/temp`],
      { encoding: 'utf8', env: { ...process.env, LANG: 'C', LC_ALL: 'C' }, windowsHide: true }
    );
    if (result.stdout.trim() !== '') {
      throw new Error('Workspace temp contains Git-tracked paths.');
    }
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT') || isNotGitRepository(error)) {
      return;
    }
    throw error;
  }
}

/**
 * Verifies a candidate remains inside an already trusted root.
 *
 * @param root Trusted canonical root.
 * @param candidate Candidate path.
 */
function assertContained(root: string, candidate: string): void {
  const result = relative(resolve(root), resolve(candidate));
  if (result.startsWith('..') || isAbsolute(result)) {
    throw new Error('Workspace attachment cache path escaped the Workspace root.');
  }
}

/**
 * Recognizes the expected Git error for a Workspace outside a repository.
 *
 * @param error Unknown child-process failure.
 * @returns Whether Git reported that the Workspace is not a repository.
 */
function isNotGitRepository(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'stderr' in error &&
    typeof error.stderr === 'string' &&
    error.stderr.includes('not a git repository')
  );
}

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

type Artifact = Omit<WorkspaceAttachmentCacheInput, 'workspaceCwd'>;
