/**
 * @author Codex
 * @description Stable scheduler domain failures independent of HTTP and Host exception classes.
 */
export class SchedulerTaskError extends Error {
  /**
   * Keep internal causes for diagnostics while presenting a safe domain message to clients.
   */
  constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'SchedulerTaskError';
  }
}
