/**
 * @author root
 * @description Prepares the fixed self-ignored Workspace attachment cache root without crossing filesystem links.
 */

import { execFile } from 'node:child_process';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { CONFIG_DIR_NAME } from '@earendil-works/pi-coding-agent';

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
 * Checks an unknown Node error for one stable code.
 *
 * @param error Unknown thrown value.
 * @param code Expected Node error code.
 * @returns Whether the error exposes the expected code.
 */
function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
