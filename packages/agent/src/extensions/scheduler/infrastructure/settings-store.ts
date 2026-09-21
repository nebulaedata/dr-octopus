/**
 * @author Codex
 * @description Persists Scheduler configuration as an atomic cron.json document outside task SQLite data.
 */
import { join } from 'node:path';
import { readMetadata, writeMetadata } from './profile.js';
import { SchedulerTaskError } from '../definitions/task-error.js';
import type {
  SchedulerSettings,
  SchedulerSettingsStore,
  SchedulerSettingsUpdate,
} from '../definitions/settings.js';

/**
 * Returns a valid local timezone without depending on a browser process.
 */
function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/**
 * Reject malformed configuration instead of silently replacing user intent.
 */
function isValid(value: SchedulerSettings): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value.timezone }).format();
    return (
      Object.keys(value).every((key) =>
        ['timezone', 'maxConcurrentRuns', 'revision', 'updatedAt'].includes(key)
      ) &&
      typeof value.timezone === 'string' &&
      value.timezone.length >= 1 &&
      value.timezone.length <= 100 &&
      Number.isSafeInteger(value.maxConcurrentRuns) &&
      value.maxConcurrentRuns >= 1 &&
      value.maxConcurrentRuns <= 32 &&
      Number.isSafeInteger(value.revision) &&
      value.revision >= 1 &&
      typeof value.updatedAt === 'string' &&
      Number.isFinite(Date.parse(value.updatedAt))
    );
  } catch {
    return false;
  }
}

/**
 * Owns the versioned cron.json document in one Scheduler profile directory.
 */
export class FileSchedulerSettingsStore implements SchedulerSettingsStore {
  private readonly path: string;

  /**
   * Bind configuration to the Scheduler profile, never the Server database.
   */
  constructor(profileDirectory: string) {
    this.path = join(profileDirectory, 'cron.json');
  }

  /**
   * Read current configuration, creating documented defaults once.
   */
  async get(): Promise<SchedulerSettings> {
    const current = await readMetadata<SchedulerSettings>(this.path);
    if (current) {
      if (!isValid(current)) {
        throw new SchedulerTaskError('SCHEDULE_SETTINGS_INVALID', 'Invalid Scheduler settings');
      }
      return current;
    }
    const defaults: SchedulerSettings = {
      timezone: localTimezone(),
      maxConcurrentRuns: 3,
      revision: 1,
      updatedAt: new Date().toISOString(),
    };
    await writeMetadata(this.path, defaults);
    return (await readMetadata<SchedulerSettings>(this.path)) ?? defaults;
  }

  /**
   * Replace the complete document only at the caller's observed revision.
   */
  async update(input: SchedulerSettingsUpdate, updatedAt: string): Promise<SchedulerSettings> {
    const current = await this.get();
    if (current.revision !== input.revision) {
      throw new SchedulerTaskError('SCHEDULE_SETTINGS_CONFLICT', 'Scheduler settings have changed');
    }
    const next: SchedulerSettings = {
      timezone: input.timezone,
      maxConcurrentRuns: input.maxConcurrentRuns,
      revision: current.revision + 1,
      updatedAt,
    };
    await writeMetadata(this.path, next);
    return next;
  }
}
