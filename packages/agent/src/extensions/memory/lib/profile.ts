/**
 * @author Codex
 * @description Canonical global memory identity and atomic lifecycle metadata independent of Agent directories.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { dirname } from 'node:path';
import { resolveMemoryPaths } from './paths.js';
import { MemoryError } from '../definitions/error.js';

export interface MemoryProfile {
  directory: string;
  dataRoot: string;
  profileId: string;
}
/**
 * Resolve symlinks before assigning one owner; status inspection never creates storage.
 */
export async function memoryProfile(dataRoot?: string, create = false): Promise<MemoryProfile | null> {
  const path = resolveMemoryPaths(dataRoot).directory;
  if (create) {
    await mkdir(path, { recursive: true, mode: 0o700 });
  }
  let directory: string;
  try {
    directory = await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  const identity = process.platform === 'win32' ? directory.toLowerCase() : directory;
  return {
    directory,
    dataRoot: await realpath(dirname(path)),
    profileId: createHash('sha256')
      .update(userInfo().username + '\0' + identity)
      .digest('hex'),
  };
}
/**
 * Only absent metadata is treated as absent; corruption cannot authorize a new owner.
 */
export async function readMemoryMetadata<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw new MemoryError('MEMORY_METADATA_INVALID', '记忆服务控制文件不可读', { cause: error });
  }
}
/**
 * Publish durable metadata atomically while holding the lifetime ownership lock.
 */
export async function writeMemoryMetadata(path: string, value: unknown): Promise<void> {
  const temporary = path + '.' + randomUUID() + '.tmp';
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(value));
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
