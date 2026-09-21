/**
 * @author Codex
 * @description Defines global Scheduler configuration independently from Host settings UI.
 */
export interface SchedulerSettings {
  timezone: string;
  maxConcurrentRuns: number;
  revision: number;
  updatedAt: string;
}

export interface SchedulerSettingsUpdate {
  timezone: string;
  maxConcurrentRuns: number;
  revision: number;
}

export interface SchedulerSettingsStore {
  get(): Promise<SchedulerSettings>;
  update(input: SchedulerSettingsUpdate, updatedAt: string): Promise<SchedulerSettings>;
}
