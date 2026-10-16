/**
 * @author Codex
 * @description Resolves device-authorized ordinary Windows paths while rejecting namespaces and linked ancestors.
 */
import { lstat, realpath } from 'node:fs/promises';
import { dirname, basename, isAbsolute, parse, relative, resolve, sep } from 'node:path';
import { BasicToolError } from './basic-inputs';
import { homedir } from 'node:os';

const privateRoots = new Set<string>([resolve(homedir(), '.dr-octopus', 'executor')]);

/**
 * Registers trusted Host-owned storage for this Runtime's lifetime; tool input cannot change this list.
 */
export function protectExecutorStorage(...roots: string[]): void {
  for (const root of roots) {
    if (!isAbsolute(root)) {
      throw new Error('Executor storage protection requires an absolute root.');
    }
    privateRoots.add(resolve(root));
  }
}

/**
 * Excludes project and transient secrets by complete path rather than ordinary child directory names.
 */
export function isExecutorStoragePath(path: string): boolean {
  return [...privateRoots].some((root) => isWithinRoot(root, resolve(path)));
}

/**
 * Tests a canonical path using path components, including the root itself.
 */
export function isWithinRoot(root: string, target: string): boolean {
  const suffix = relative(root, target);
  return suffix === '' || (!isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith('..' + sep));
}

/**
 * Rejects aliases and namespaces before resolving an untrusted Windows path.
 * This policy is for ordinary files, not shell sandboxing or hostile same-user race isolation.
 */
function validateLocalPath(input: string): void {
  if (
    process.platform !== 'win32' ||
    [...input].some((character) => character.charCodeAt(0) < 32) ||
    /[<>"|?*]/.test(input) ||
    input.includes('~') ||
    /^[\\/]/.test(input) ||
    /^[a-z]:[^\\/]/i.test(input) ||
    input.includes('/') ||
    input.replace(/^[a-z]:/i, '').includes(':')
  ) {
    throw new BasicToolError('PATH_REJECTED', 'Only ordinary local Windows paths are accepted.');
  }
  if (/^[a-z]:\\$/i.test(input)) {
    return;
  }
  for (const part of input.replace(/^[a-z]:\\/i, '').split('\\')) {
    if (part === '.' || part === '..') {
      continue;
    }
    if (
      part.length === 0 ||
      /[. ]$/.test(part) ||
      /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part) ||
      part.toLowerCase().startsWith('.octopus-executor-recovery-') ||
      /^octopus-executor-[0-9a-f-]{36}$/i.test(part)
    ) {
      throw new BasicToolError('PATH_REJECTED', 'The path contains a reserved component.');
    }
  }
}

/**
 * Checks ordinary Windows syntax before normalization can erase an ambiguous input spelling.
 * @returns The absolute execution path; existence and native checks belong to the I/O boundary.
 */
export function resolveLocalPath(input: string, cwd: string): string {
  validateLocalPath(input);
  const target = resolve(cwd, input);
  if (isExecutorStoragePath(target)) {
    throw new BasicToolError('PATH_REJECTED', 'Executor internal storage is not available to file tools.');
  }
  return target;
}

/**
 * Resolves an ordinary device directory relative to the task cwd, which is not an authorization boundary.
 */
export async function resolveSearchDirectory(input: string, cwd: string): Promise<string> {
  const target = resolveLocalPath(input, cwd);
  return resolveLocalDirectory(target);
}

/**
 * Checks each existing ancestor, up to the local volume root.
 * Node detects symlinks and junctions here; full native reparse-tag enforcement belongs to the commit backend.
 */
async function rejectLinkedAncestors(target: string): Promise<void> {
  const volumeRoot = parse(target).root;
  let current = volumeRoot;
  for (const part of relative(volumeRoot, target).split(sep).filter(Boolean)) {
    current = resolve(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) {
      throw new BasicToolError('PATH_REJECTED', 'Linked paths are not permitted.');
    }
  }
}

/**
 * Canonicalizes an existing ordinary directory without changing the caller's device capabilities.
 */
export async function resolveLocalDirectory(directory: string): Promise<string> {
  validateLocalPath(directory);
  if (isExecutorStoragePath(directory)) {
    throw new BasicToolError('PATH_REJECTED', 'Executor internal storage is not available to file tools.');
  }
  if (!isAbsolute(directory)) {
    throw new BasicToolError('PATH_REJECTED', 'Resolved directories must be absolute.');
  }
  await rejectLinkedAncestors(directory);
  if (!(await lstat(directory)).isDirectory()) {
    throw new BasicToolError('PATH_REJECTED', 'The directory must exist.');
  }
  return realpath(directory);
}

/**
 * Resolves an existing ordinary file on this device without changing the task working directory.
 */
export async function resolveReadableFile(input: string, cwd: string): Promise<string> {
  const target = resolveLocalPath(input, cwd);
  await rejectLinkedAncestors(target);
  const canonical = await realpath(target);
  if (!(await lstat(canonical)).isFile()) {
    throw new BasicToolError('UNSUPPORTED_FILE', 'Only ordinary files can be read.');
  }
  return canonical;
}

/**
 * Resolves a mutation target with an existing ordinary parent. Missing parent creation remains unsupported.
 * A missing final component is allowed for write; reparse/native/NTFS checks run again in the publisher.
 */
export async function resolveMutationFile(input: string, cwd: string): Promise<string> {
  const target = resolveLocalPath(input, cwd);
  const parent = await resolveLocalDirectory(dirname(target));
  const canonical = resolve(parent, basename(target));
  try {
    return await resolveReadableFile(canonical, cwd);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return canonical;
    }
    throw error;
  }
}
