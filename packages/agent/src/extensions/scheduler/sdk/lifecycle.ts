/**
 * @author Codex
 * @description Profile-scoped daemon discovery and serialized lifecycle commands without Pi or DB loading.
 */
import { readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { SchedulerLifecycleError } from '../definitions/lifecycle.js';
import { readMetadata, resolveSchedulerProfile, writeMetadata } from '../infrastructure/profile.js';
import { FileSchedulerSettingsStore } from '../infrastructure/settings-store.js';
import { SchedulerSettingsService } from '../services/settings-service.js';
import { resolveSchedulerDaemonEntry } from '../infrastructure/daemon-entry.js';
import type {
  SchedulerControl,
  SchedulerEndpoint,
  SchedulerServiceStatus,
} from '../definitions/service-lifecycle.js';
import type { SchedulerProfile } from '../infrastructure/profile.js';
import type { SchedulerSettings, SchedulerSettingsUpdate } from '../definitions/settings.js';

type LifecycleEndpoint = Omit<SchedulerEndpoint, 'protocol'> & { protocol: number };

/**
 * Validate discovery before constructing a loopback request; only stop supports the previous control protocol.
 */
async function discover(
  profile: SchedulerProfile,
  allowLegacyStop = false
): Promise<LifecycleEndpoint | null> {
  const value = await readMetadata<LifecycleEndpoint>(join(profile.directory, 'endpoint.json'));
  if (!value) {
    return null;
  }
  if (value.profileId !== profile.profileId) {
    throw new SchedulerLifecycleError('SCHEDULER_PROFILE_MISMATCH', 'Scheduler profile identity mismatch');
  }
  if (value.protocol !== 3 && !(allowLegacyStop && value.protocol === 2)) {
    throw new SchedulerLifecycleError(
      'SCHEDULER_VERSION_CONFLICT',
      `Scheduler protocol ${value.protocol} is incompatible with 3; restart the scheduler service to upgrade protocol 2.`
    );
  }
  if (
    !Number.isInteger(value.port) ||
    value.port < 1 ||
    value.port > 65535 ||
    typeof value.daemonId !== 'string'
  ) {
    throw new SchedulerLifecycleError('SCHEDULER_UNAVAILABLE', 'Invalid scheduler discovery metadata');
  }
  return value;
}

/**
 * Call the exact discovered daemon, bounded by deadline and response size.
 */
async function request<T>(
  profile: SchedulerProfile,
  endpoint: LifecycleEndpoint,
  action: 'status' | 'stop' | 'settings-read' | 'settings-update',
  body?: SchedulerSettingsUpdate
): Promise<T> {
  const token = await readFile(join(profile.directory, 'credentials', 'control-token'), 'utf8');
  const settings = action === 'settings-read' || action === 'settings-update';
  const response = await fetch(
    `http://127.0.0.1:${endpoint.port}/scheduler/v1/service/${settings ? 'settings' : action}`,
    {
      method: action === 'status' || action === 'settings-read' ? 'GET' : action === 'stop' ? 'POST' : 'PUT',
      redirect: 'error',
      signal: AbortSignal.timeout(2000),
      headers: {
        authorization: 'Bearer ' + token,
        ...(body ? { 'content-type': 'application/json' } : {}),
        'x-scheduler-daemon': endpoint.daemonId,
        'x-scheduler-profile': profile.profileId,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }
  );
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  if (reader) {
    while (true) {
      const item = await reader.read();
      if (item.done) {
        break;
      }
      const chunk: unknown = item.value;
      if (!(chunk instanceof Uint8Array)) {
        throw new Error('Invalid scheduler response chunk');
      }
      length += chunk.length;
      if (length > 4096) {
        await reader.cancel();
        throw new Error('Scheduler response exceeded limit');
      }
      chunks.push(chunk);
    }
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  if (!response.ok) {
    const failure = value as { code?: unknown; message?: unknown };
    throw new SchedulerLifecycleError(
      typeof failure.code === 'string' ? failure.code : 'SCHEDULER_UNAVAILABLE',
      typeof failure.message === 'string' ? failure.message : 'Scheduler control request rejected'
    );
  }
  if (
    action === 'status' &&
    (value === null ||
      typeof value !== 'object' ||
      !('daemonId' in value) ||
      value.daemonId !== endpoint.daemonId ||
      !('profileId' in value) ||
      value.profileId !== profile.profileId)
  ) {
    throw new SchedulerLifecycleError('SCHEDULER_PROFILE_MISMATCH', 'Scheduler response identity mismatch');
  }
  return value;
}

/**
 * Read current state without creating directories, launching a process or changing stopped intent.
 */
export async function getSchedulerServiceStatus(agentDir: string): Promise<SchedulerServiceStatus> {
  const profile = await resolveSchedulerProfile(agentDir, false);
  if (!profile) {
    return { state: 'absent' };
  }
  const endpoint = await discover(profile);
  if (endpoint) {
    try {
      return await request<SchedulerServiceStatus>(profile, endpoint, 'status');
    } catch {
      return { state: 'unavailable' };
    }
  }
  const control = await readMetadata<SchedulerControl>(join(profile.directory, 'control.json'));
  return { state: control?.stopped ? 'stopped' : 'absent' };
}

/**
 * Start candidates concurrently; only the OS lock winner may publish its endpoint.
 * Explicit start may clear stopped intent under lock, while automatic ensure never does.
 */
export async function startSchedulerService(
  agentDir: string,
  explicit = true
): Promise<SchedulerServiceStatus> {
  const profile = await resolveSchedulerProfile(agentDir, true);
  if (!profile) {
    throw new Error('Scheduler profile unavailable');
  }
  const current = await getSchedulerServiceStatus(agentDir);
  if (current.state === 'control-ready') {
    return current;
  }
  const control = await readMetadata<SchedulerControl>(join(profile.directory, 'control.json'));
  if (control?.stopped && !explicit) {
    throw new SchedulerLifecycleError('SCHEDULER_STOPPED', 'Scheduler was explicitly stopped');
  }
  const { launchDetachedNode } = await import('../infrastructure/detached-launcher.js');
  await launchDetachedNode(
    [
      await resolveSchedulerDaemonEntry(),
      resolve(agentDir),
      explicit ? 'start' : 'ensure',
      String(control?.revision ?? 0),
    ],
    profile.directory
  );
  const deadline = Date.now() + 15000;
  do {
    const status = await getSchedulerServiceStatus(agentDir);
    if (status.state === 'control-ready') {
      return status;
    }
    const latest = await readMetadata<SchedulerControl>(join(profile.directory, 'control.json'));
    if (latest?.stopped && (!explicit || latest.revision !== (control?.revision ?? 0))) {
      throw new SchedulerLifecycleError('SCHEDULER_STOPPED', 'Scheduler stopped during startup');
    }
    await delay(100);
  } while (Date.now() < deadline);
  throw new SchedulerLifecycleError(
    'SCHEDULER_UNAVAILABLE',
    'Scheduler did not become ready before deadline'
  );
}

/**
 * Persist stop under the same lifetime lock or ask its online owner; never kill a discovered PID.
 */
export async function stopSchedulerService(agentDir: string): Promise<SchedulerServiceStatus> {
  const profile = await resolveSchedulerProfile(agentDir, true);
  if (!profile) {
    throw new Error('Scheduler profile unavailable');
  }
  const { tryAcquireSingletonLease } = await import('../infrastructure/singleton-lease.js');
  const deadline = Date.now() + 15000;
  do {
    const lease = await tryAcquireSingletonLease(join(profile.directory, 'daemon.lock'));
    if (lease) {
      try {
        const control = await readMetadata<SchedulerControl>(join(profile.directory, 'control.json'));
        await writeMetadata(join(profile.directory, 'control.json'), {
          stopped: true,
          revision: (control?.revision ?? 0) + 1,
        });
        await rm(join(profile.directory, 'endpoint.json'), { force: true });
        return { state: 'stopped' };
      } finally {
        lease.release();
      }
    }
    const endpoint = await discover(profile, true);
    if (endpoint) {
      try {
        await request<SchedulerServiceStatus>(profile, endpoint, 'stop');
      } catch {
        /* Owner may be closing; wait for its lock. */
      }
    }
    await delay(100);
  } while (Date.now() < deadline);
  throw new SchedulerLifecycleError('SCHEDULER_UNAVAILABLE', 'Scheduler owner has not released its lock');
}

/**
 * Restart only after stop confirms that the previous process released its lifecycle ownership.
 */
export async function restartSchedulerService(agentDir: string): Promise<SchedulerServiceStatus> {
  await stopSchedulerService(agentDir);
  return startSchedulerService(agentDir);
}

/**
 * Read the atomic cron.json configuration without requiring a running daemon.
 */
export async function getSchedulerSettings(agentDir: string): Promise<SchedulerSettings> {
  const profile = await resolveSchedulerProfile(agentDir, true);
  if (!profile) {
    throw new SchedulerLifecycleError('SCHEDULER_UNAVAILABLE', 'Scheduler profile unavailable');
  }
  return new SchedulerSettingsService(new FileSchedulerSettingsStore(profile.directory)).get();
}

/**
 * Update cron.json through the online owner, or under the lifecycle lock while offline.
 */
export async function updateSchedulerSettings(
  agentDir: string,
  input: SchedulerSettingsUpdate
): Promise<SchedulerSettings> {
  const profile = await resolveSchedulerProfile(agentDir, true);
  if (!profile) {
    throw new SchedulerLifecycleError('SCHEDULER_UNAVAILABLE', 'Scheduler profile unavailable');
  }
  const endpoint = await discover(profile);
  if (endpoint) {
    try {
      return await request<SchedulerSettings>(profile, endpoint, 'settings-update', input);
    } catch (cause) {
      if (await discover(profile)) {
        throw cause;
      }
    }
  }
  const { tryAcquireSingletonLease } = await import('../infrastructure/singleton-lease.js');
  const lease = await tryAcquireSingletonLease(join(profile.directory, 'daemon.lock'));
  if (!lease) {
    throw new SchedulerLifecycleError('SCHEDULER_UNAVAILABLE', 'Scheduler settings owner is unavailable');
  }
  try {
    return await new SchedulerSettingsService(new FileSchedulerSettingsStore(profile.directory)).update(
      input
    );
  } finally {
    lease.release();
  }
}
