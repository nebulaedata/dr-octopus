/**
 * @author Codex
 * @description Cross-profile shared lifetime lock preventing in-place installation over a running knowledge daemon.
 */
import { access, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tryAcquireProcessLock } from '../../../lib/daemon-platform/singleton-lease.js';
import { KnowledgeError } from '../definitions/error.js';

/**
 * Find the physical release root and hold a shared native lock before loading heavy runtime dependencies.
 */
export async function acquireKnowledgeReleaseUse(entry: string) {
  let candidate = dirname(await realpath(fileURLToPath(entry)));
  let packageRoot: string | undefined;
  while (dirname(candidate) !== candidate) {
    if (
      (await exists(join(candidate, 'release-layout.json'))) ||
      (await exists(join(candidate, 'pnpm-workspace.yaml')))
    ) {
      if (await exists(candidate + '.install.lock')) {
        throw new KnowledgeError('RELEASE_IN_USE', '当前发行目录正在安装依赖');
      }
      const lock = await tryAcquireProcessLock(candidate + '.knowledge-use.lock', 'shared');
      if (!lock) {
        throw new KnowledgeError('RELEASE_IN_USE', '当前发行目录正在安装依赖，请稍后启动');
      }
      if (await exists(candidate + '.install.lock')) {
        lock.release();
        throw new KnowledgeError('RELEASE_IN_USE', '当前发行目录正在安装依赖');
      }
      return lock;
    }
    if (!packageRoot && (await exists(join(candidate, 'package.json')))) {
      packageRoot = candidate;
    }
    candidate = dirname(candidate);
  }
  if (!packageRoot) {
    throw new KnowledgeError('RELEASE_USE_UNVERIFIED', '无法确认知识库运行目录');
  }
  const lock = await tryAcquireProcessLock(packageRoot + '.knowledge-use.lock', 'shared');
  if (!lock) {
    throw new KnowledgeError('RELEASE_IN_USE', '运行目录正在更新');
  }
  return lock;
}

/**
 * Treat only absent files as absent boundaries; permission errors prevent uncertain ownership.
 */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}
