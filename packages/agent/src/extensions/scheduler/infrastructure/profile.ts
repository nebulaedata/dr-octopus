/**
 * @author Codex
 * @description Canonical scheduler profile identity and atomic lifecycle metadata, without database imports.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { dirname, join } from 'node:path';

export interface SchedulerProfile {
  directory: string;
  profileId: string;
}

/**
 * Resolve aliases before forming singleton identity; read-only calls never create missing directories.
 */
export async function resolveSchedulerProfile(
  agentDir: string,
  create: boolean
): Promise<SchedulerProfile | null> {
  if (create) {
    await mkdir(agentDir, { recursive: true, mode: 0o700 });
  }
  let canonical: string;
  try {
    canonical = await realpath(agentDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  const dataRoot = dirname(canonical);
  const identity = process.platform === 'win32' ? dataRoot.toLowerCase() : dataRoot;
  const profileId = createHash('sha256')
    .update(userInfo().username + '\0' + identity)
    .digest('hex');
  const directory = join(dataRoot, 'scheduler');
  if (create) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
  }
  return { directory, profileId };
}

/**
 * Read metadata without swallowing corruption or permission failures.
 */
export async function readMetadata<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Publish a complete metadata document while the caller holds the profile lifecycle lock.
 */
export async function writeMetadata(path: string, value: unknown): Promise<void> {
  const temporary = path + '.' + randomUUID() + '.tmp';
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
