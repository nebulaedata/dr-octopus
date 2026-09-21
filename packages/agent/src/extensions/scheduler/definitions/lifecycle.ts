/**
 * @author Codex
 * @description Scheduler daemon lifecycle contracts independent of Pi and database implementations.
 */
export interface SingletonLease {
  /**
   * Release the process-held lock exactly once, after all owned resources close.
   */
  release(): void;
}

export class SchedulerLifecycleError extends Error {
  /**
   * Preserve a stable lifecycle failure without exposing credentials.
   */
  constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'SchedulerLifecycleError';
  }
}
