/**
 * @author Codex
 * @description Host-independent lifecycle errors and lifetime lock ownership for local daemons.
 */
export interface ProcessLock {
  /**
   * Release only this owner's native handle after all owned work stops.
   */
  release(): void;
}

export class ProcessLifecycleError extends Error {
  /**
   * Preserve a stable platform error without coupling the primitive to an extension.
   */
  constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'ProcessLifecycleError';
  }
}
