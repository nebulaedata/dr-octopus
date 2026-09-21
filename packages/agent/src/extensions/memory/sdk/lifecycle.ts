/**
 * @author Codex
 * @description Explicit and lazy daemon lifecycle with persistent stop suppression and OS-lock ownership.
 */
import { access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { MemoryError } from '../definitions/error.js';
import { memoryProfile, readMemoryMetadata, writeMemoryMetadata } from '../lib/profile.js';
import { discoverMemory, memoryRequest } from './transport.js';
import type { MemoryControl, MemoryServiceStatus } from '../definitions/lifecycle.js';

/**
 * Observe only; neither an absent directory nor a stopped service is automatically created.
 */
export async function getMemoryServiceStatus(
  dataRoot?: string,
  timeoutMs = 3000
): Promise<MemoryServiceStatus> {
  const profile = await memoryProfile(dataRoot);
  if (!profile) {
    return { schemaVersion: 1, state: 'absent', health: 'unknown', autostartSuppressed: false };
  }
  const control = await readMemoryMetadata<MemoryControl>(join(profile.directory, 'control.json'));
  const endpoint = await discoverMemory(profile);
  if (endpoint) {
    try {
      const status = await memoryRequest<MemoryServiceStatus>(
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
export async function startMemoryService(
  dataRoot?: string,
  timeoutMs = 30_000,
  explicit = true,
  expectedRevision?: number,
  migrationsFolder?: string,
  signal?: AbortSignal
): Promise<MemoryServiceStatus> {
  signal?.throwIfAborted();
  const profile = (await memoryProfile(dataRoot, true))!;
  const current = await getMemoryServiceStatus(dataRoot);
  if (current.state === 'running') {
    return current;
  }
  const control = await readMemoryMetadata<MemoryControl>(join(profile.directory, 'control.json'));
  if (expectedRevision !== undefined && control?.revision !== expectedRevision) {
    throw new MemoryError('MEMORY_SERVICE_STOPPED', '重启已被较新的启停操作取消');
  }
  if (control?.stopped && !explicit) {
    throw new MemoryError('MEMORY_SERVICE_STOPPED', '记忆服务已停止，请在系统设置 → 记忆中启动服务');
  }
  const entry = fileURLToPath(
    new URL(
      import.meta.url.endsWith('.ts')
        ? '../../../../dist/extensions/memory/daemon/entry.js'
        : '../daemon/entry.js',
      import.meta.url
    )
  );
  await access(entry);
  const { launchDetachedNode } = await import('../../../lib/daemon-platform/detached-launcher.js');
  const requestedAt = Date.now();
  signal?.throwIfAborted();
  await launchDetachedNode(
    [
      entry,
      profile.dataRoot,
      explicit ? 'start' : 'ensure',
      String(control?.revision ?? 0),
      ...(migrationsFolder ? [migrationsFolder] : []),
    ],
    profile.directory
  );
  const deadline = Date.now() + timeoutMs;
  do {
    signal?.throwIfAborted();
    const status = await getMemoryServiceStatus(dataRoot);
    if (status.state === 'running') {
      return status;
    }
    const latest = await readMemoryMetadata<MemoryControl>(join(profile.directory, 'control.json'));
    const failure = await readMemoryMetadata<{ at: number; code: string }>(
      join(profile.directory, 'startup-error.json')
    );
    if (failure && failure.at >= requestedAt) {
      throw new MemoryError(
        'MEMORY_START_FAILED',
        `记忆服务启动失败（${failure.code}），请检查安装依赖与数据目录`
      );
    }
    if (latest?.stopped && (!explicit || latest.revision !== (control?.revision ?? 0))) {
      throw new MemoryError('MEMORY_SERVICE_STOPPED', '启动已被较新的停止操作取消');
    }
    await delay(100, undefined, { signal });
  } while (Date.now() < deadline);
  throw new MemoryError('MEMORY_SERVICE_TIMEOUT', '记忆服务未能及时启动，请检查依赖和服务状态');
}

/**
 * Persist stop either under the lifetime lock or through its owner; never kill a PID.
 */
export async function stopMemoryService(dataRoot?: string, timeoutMs = 30_000): Promise<MemoryServiceStatus> {
  const profile = (await memoryProfile(dataRoot, true))!;
  const { tryAcquireProcessLock } = await import('../../../lib/daemon-platform/singleton-lease.js');
  const deadline = Date.now() + timeoutMs;
  do {
    const lock = await tryAcquireProcessLock(join(profile.directory, 'daemon.lock'));
    if (lock) {
      try {
        const control = await readMemoryMetadata<MemoryControl>(join(profile.directory, 'control.json'));
        const controlRevision = (control?.revision ?? 0) + 1;
        await writeMemoryMetadata(join(profile.directory, 'control.json'), {
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
    const endpoint = await discoverMemory(profile);
    if (endpoint) {
      try {
        await memoryRequest(profile, endpoint, 'stop', {}, undefined, 3000);
      } catch {
        // Ownership may be draining; only acquiring its released OS lock proves completion.
      }
    }
    await delay(100);
  } while (Date.now() < deadline);
  throw new MemoryError('MEMORY_SERVICE_TIMEOUT', '停止尚未完成，请查询 status；不会强杀进程');
}

/**
 * Preflight the installed entry before stopping the current owner.
 */
export async function restartMemoryService(
  dataRoot?: string,
  timeoutMs = 30_000
): Promise<MemoryServiceStatus> {
  await access(
    fileURLToPath(
      new URL(
        import.meta.url.endsWith('.ts')
          ? '../../../../dist/extensions/memory/daemon/entry.js'
          : '../daemon/entry.js',
        import.meta.url
      )
    )
  );
  const stopped = await stopMemoryService(dataRoot, timeoutMs);
  return startMemoryService(dataRoot, timeoutMs, true, stopped.controlRevision);
}

/**
 * Inspect local storage/configuration without making model calls or implicitly starting the service.
 */
export async function checkMemoryServiceHealth(
  dataRoot?: string,
  timeoutMs = 3000
): Promise<MemoryServiceStatus> {
  const status = await getMemoryServiceStatus(dataRoot, timeoutMs);
  if (status.state !== 'running') {
    return status;
  }
  const profile = (await memoryProfile(dataRoot, true))!;
  return memoryRequest(profile, (await discoverMemory(profile))!, 'health', undefined, undefined, timeoutMs);
}
