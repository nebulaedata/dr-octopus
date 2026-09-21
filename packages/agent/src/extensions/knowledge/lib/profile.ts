/**
 * @author Codex
 * @description Canonical per-user Agent profile identity and atomic knowledge control metadata.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { KnowledgeError } from '../definitions/error.js';

export interface KnowledgeProfile {
  directory: string;
  agentDir: string;
  profileId: string;
}

/**
 * Resolve aliases and share the Agent parent data root with other extensions; observation never creates directories.
 */
export async function knowledgeProfile(agentDir: string, create = false): Promise<KnowledgeProfile | null> {
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
  const directory = join(dataRoot, 'knowledge');
  if (create) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
  }
  return {
    directory,
    agentDir: canonical,
    profileId: createHash('sha256')
      .update(userInfo().username + '\0' + identity)
      .digest('hex'),
  };
}

/**
 * Read absent metadata without masking corruption or permission failures.
 */
export async function readKnowledgeMetadata<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw new KnowledgeError('KNOWLEDGE_METADATA_INVALID', '知识服务控制文件不可读', false, { cause: error });
  }
}

/**
 * Atomically publish metadata while the caller holds the relevant process lock.
 */
export async function writeKnowledgeMetadata(path: string, value: unknown): Promise<void> {
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
