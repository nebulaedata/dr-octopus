/**
 * @author Codex
 * @description Hold the daemon lifetime lock for an explicitly stopped offline maintenance operation.
 */
import { join } from 'node:path';
import { KnowledgeError } from '../definitions/error.js';
import { knowledgeProfile, readKnowledgeMetadata } from '../lib/profile.js';
import type { KnowledgeControl } from '../definitions/lifecycle.js';

/**
 * Run a caller-owned backup while retaining continuous singleton exclusion.
 * The caller copies the whole directory to a private destination, excluding daemon.lock and endpoint.json.
 * @throws When the profile has not been explicitly stopped or another owner holds its lock.
 */
export async function withStoppedKnowledgeService<T>(
  agentDir: string,
  operation: (directory: string) => Promise<T>
): Promise<T> {
  const profile = await knowledgeProfile(agentDir);
  if (!profile) {
    throw new KnowledgeError('NOT_FOUND', '知识服务目录不存在');
  }
  const { tryAcquireProcessLock } = await import('../../../lib/daemon-platform/singleton-lease.js');
  const lock = await tryAcquireProcessLock(join(profile.directory, 'daemon.lock'));
  if (!lock) {
    throw new KnowledgeError('KNOWLEDGE_SERVICE_BUSY', '请先停止知识服务，再执行离线维护');
  }
  try {
    const control = await readKnowledgeMetadata<KnowledgeControl>(join(profile.directory, 'control.json'));
    if (!control?.stopped) {
      throw new KnowledgeError('KNOWLEDGE_SERVICE_BUSY', '请先显式停止知识服务');
    }
    return await operation(profile.directory);
  } finally {
    lock.release();
  }
}
