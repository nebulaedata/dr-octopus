/**
 * @author Codex
 * @description Explicit and lazy daemon lifecycle with persistent stop suppression and OS-lock ownership.
 */
import { access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { KnowledgeError } from '../definitions/error.js';
import { knowledgeProfile, readKnowledgeMetadata, writeKnowledgeMetadata } from '../lib/profile.js';
import { discoverKnowledge, knowledgeRequest } from './transport.js';
import type { KnowledgeControl, KnowledgeServiceStatus } from '../definitions/lifecycle.js';

/**
 * Observe only; neither an absent directory nor a stopped service is automatically created.
 */
export async function getKnowledgeServiceStatus(
  agentDir: string,
  timeoutMs = 3000
): Promise<KnowledgeServiceStatus> {
  const profile = await knowledgeProfile(agentDir);
  if (!profile) {
    return { schemaVersion: 1, state: 'absent', health: 'unknown', autostartSuppressed: false };
  }
  const control = await readKnowledgeMetadata<KnowledgeControl>(join(profile.directory, 'control.json'));
  const endpoint = await discoverKnowledge(profile);
  if (endpoint) {
    try {
      const status = await knowledgeRequest<KnowledgeServiceStatus>(
        profile,
        endpoint,
        'status',
        undefined,
        undefined,
        timeoutMs
      );
      if (status.profileId !== profile.profileId || status.daemonId !== endpoint.daemonId) {
        throw new Error('Identity mismatch');
      }
      return status;
    } catch {
      return {
        schemaVersion: 1,
        state: 'unavailable',
        health: 'unavailable',
        autostartSuppressed: control?.stopped ?? false,
      };
    }
  }
  return {
    schemaVersion: 1,
    state: control?.stopped ? 'stopped' : 'absent',
    health: 'unknown',
    profileId: profile.profileId,
    autostartSuppressed: control?.stopped ?? false,
  };
}

/**
 * Start candidates; only the native-lock winner initializes storage and publishes discovery.
 */
export async function startKnowledgeService(
  agentDir: string,
  timeoutMs = 30_000,
  explicit = true,
  expectedRevision?: number
): Promise<KnowledgeServiceStatus> {
  const profile = (await knowledgeProfile(agentDir, true))!;
  const current = await getKnowledgeServiceStatus(agentDir);
  if (current.state === 'running') {
    return current;
  }
  const control = await readKnowledgeMetadata<KnowledgeControl>(join(profile.directory, 'control.json'));
  if (expectedRevision !== undefined && control?.revision !== expectedRevision) {
    throw new KnowledgeError('KNOWLEDGE_SERVICE_STOPPED', '重启已被较新的启停操作取消');
  }
  if (control?.stopped && !explicit) {
    throw new KnowledgeError('KNOWLEDGE_SERVICE_STOPPED', '知识服务已停止，请执行 octopus knowledge start');
  }
  const entry = fileURLToPath(
    new URL(
      import.meta.url.endsWith('.ts')
        ? '../../../../dist/extensions/knowledge/daemon/entry.js'
        : '../daemon/entry.js',
      import.meta.url
    )
  );
  await access(entry);
  const { launchDetachedNode } = await import('../../../lib/daemon-platform/detached-launcher.js');
  const requestedAt = Date.now();
  await launchDetachedNode(
    [entry, profile.agentDir, explicit ? 'start' : 'ensure', String(control?.revision ?? 0)],
    profile.directory
  );
  const deadline = Date.now() + timeoutMs;
  do {
    const status = await getKnowledgeServiceStatus(agentDir);
    if (status.state === 'running') {
      return status;
    }
    const latest = await readKnowledgeMetadata<KnowledgeControl>(join(profile.directory, 'control.json'));
    const failure = await readKnowledgeMetadata<{ at: number; code: string }>(
      join(profile.directory, 'startup-error.json')
    );
    if (failure && failure.at >= requestedAt) {
      throw new KnowledgeError(
        'KNOWLEDGE_START_FAILED',
        `知识服务启动失败（${failure.code}），请检查安装依赖与数据目录`
      );
    }
    if (latest?.stopped && (!explicit || latest.revision !== (control?.revision ?? 0))) {
      throw new KnowledgeError('KNOWLEDGE_SERVICE_STOPPED', '启动已被较新的停止操作取消');
    }
    await delay(100);
  } while (Date.now() < deadline);
  throw new KnowledgeError('KNOWLEDGE_SERVICE_TIMEOUT', '知识服务未能及时启动，请检查依赖和服务状态', true);
}

/**
 * Persist stop either under the lifetime lock or through its owner; never kill a PID.
 */
export async function stopKnowledgeService(
  agentDir: string,
  timeoutMs = 30_000
): Promise<KnowledgeServiceStatus> {
  const profile = (await knowledgeProfile(agentDir, true))!;
  const { tryAcquireProcessLock } = await import('../../../lib/daemon-platform/singleton-lease.js');
  const deadline = Date.now() + timeoutMs;
  do {
    const lock = await tryAcquireProcessLock(join(profile.directory, 'daemon.lock'));
    if (lock) {
      try {
        const control = await readKnowledgeMetadata<KnowledgeControl>(
          join(profile.directory, 'control.json')
        );
        const controlRevision = (control?.revision ?? 0) + 1;
        await writeKnowledgeMetadata(join(profile.directory, 'control.json'), {
          stopped: true,
          revision: controlRevision,
        });
        await rm(join(profile.directory, 'endpoint.json'), { force: true });
        return {
          schemaVersion: 1,
          state: 'stopped',
          health: 'unknown',
          profileId: profile.profileId,
          autostartSuppressed: true,
          controlRevision,
        };
      } finally {
        lock.release();
      }
    }
    const endpoint = await discoverKnowledge(profile);
    if (endpoint) {
      try {
        await knowledgeRequest(profile, endpoint, 'stop', {}, undefined, 3000);
      } catch {
        // Ownership may be draining; only acquiring its released OS lock proves completion.
      }
    }
    await delay(100);
  } while (Date.now() < deadline);
  throw new KnowledgeError('KNOWLEDGE_SERVICE_TIMEOUT', '停止尚未完成，请查询 status；不会强杀进程', true);
}

/**
 * Preflight the installed entry before stopping the current owner.
 */
export async function restartKnowledgeService(
  agentDir: string,
  timeoutMs = 30_000
): Promise<KnowledgeServiceStatus> {
  await access(
    fileURLToPath(
      new URL(
        import.meta.url.endsWith('.ts')
          ? '../../../../dist/extensions/knowledge/daemon/entry.js'
          : '../daemon/entry.js',
        import.meta.url
      )
    )
  );
  const stopped = await stopKnowledgeService(agentDir, timeoutMs);
  return startKnowledgeService(agentDir, timeoutMs, true, stopped.controlRevision);
}

/**
 * Inspect local storage/configuration without making model calls or implicitly starting the service.
 */
export async function checkKnowledgeServiceHealth(
  agentDir: string,
  timeoutMs = 3000
): Promise<KnowledgeServiceStatus> {
  const status = await getKnowledgeServiceStatus(agentDir, timeoutMs);
  if (status.state !== 'running') {
    return status;
  }
  const profile = (await knowledgeProfile(agentDir))!;
  return knowledgeRequest(
    profile,
    (await discoverKnowledge(profile))!,
    'health',
    undefined,
    undefined,
    timeoutMs
  );
}
