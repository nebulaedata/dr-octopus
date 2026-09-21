/**
 * @author Codex
 * @description Validates and applies global Scheduler configuration through one persistence port.
 */
import { SchedulerTaskError } from '../definitions/task-error.js';
import type {
  SchedulerSettings,
  SchedulerSettingsStore,
  SchedulerSettingsUpdate,
} from '../definitions/settings.js';

/**
 * Owns Scheduler configuration validation and optimistic updates.
 */
export class SchedulerSettingsService {
  private updateTail: Promise<void> = Promise.resolve();

  /**
   * Inject the daemon-owned settings store and clock.
   */
  constructor(
    private readonly store: SchedulerSettingsStore,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  /**
   * Return the complete current settings document.
   */
  get(): Promise<SchedulerSettings> {
    return this.store.get();
  }

  /**
   * Validate IANA timezone and bounded concurrency before persistence.
   */
  update(value: unknown): Promise<SchedulerSettings> {
    const operation = this.updateTail.then(() => this.applyUpdate(value));
    this.updateTail = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  /**
   * Validate and persist one update after earlier writers have settled.
   */
  private async applyUpdate(value: unknown): Promise<SchedulerSettings> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw this.invalid();
    }
    const input = value as Partial<SchedulerSettingsUpdate>;
    if (
      Object.keys(input).some((key) => !['timezone', 'maxConcurrentRuns', 'revision'].includes(key)) ||
      typeof input.timezone !== 'string' ||
      input.timezone.length < 1 ||
      input.timezone.length > 100 ||
      !Number.isSafeInteger(input.maxConcurrentRuns) ||
      input.maxConcurrentRuns! < 1 ||
      input.maxConcurrentRuns! > 32 ||
      !Number.isSafeInteger(input.revision) ||
      input.revision! < 1
    ) {
      throw this.invalid();
    }
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: input.timezone }).format();
    } catch {
      throw this.invalid();
    }
    return this.store.update(input as SchedulerSettingsUpdate, this.now());
  }

  /**
   * Return one stable validation failure without reflecting supplied values.
   */
  private invalid(): SchedulerTaskError {
    return new SchedulerTaskError('SCHEDULE_SETTINGS_INVALID', 'Invalid Scheduler settings');
  }
}
