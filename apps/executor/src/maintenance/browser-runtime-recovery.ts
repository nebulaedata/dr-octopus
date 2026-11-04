/**
 * @author Codex
 * @description Bounds Browser-driven Runtime restart after unexpected exits while preserving explicit stop and unresolved desktop-control state.
 */
import type { RuntimeSnapshot } from '../contracts/runtime';

type Lifecycle = {
  /**
   * Reads the owning Main's authoritative lifecycle and desktop-control state.
   */
  readStatus(): Pick<RuntimeSnapshot, 'state' | 'startedAt' | 'startupFailure' | 'computerUse'>;
  /**
   * Starts the existing Runtime without submitting tasks or changing consent.
   */
  start(): Promise<void>;
};

export class BrowserRuntimeRecovery {
  private attempts = 0;
  private pending = false;

  /**
   * Borrows Main's existing lifecycle authority; the owner invokes recovery only on its bounded maintenance timer.
   */
  constructor(private readonly runtime: Lifecycle) {}

  /**
   * Allows two recovery starts per Main lifetime, only after a previously ready Runtime exited unexpectedly.
   */
  async recover(browserEnabled: boolean): Promise<boolean> {
    const snapshot = this.runtime.readStatus();
    if (
      !browserEnabled ||
      this.pending ||
      this.attempts >= 2 ||
      snapshot.state !== 'failed' ||
      !snapshot.startedAt ||
      snapshot.startupFailure ||
      snapshot.computerUse.state !== 'idle'
    ) {
      return false;
    }
    this.attempts++;
    this.pending = true;
    try {
      await this.runtime.start();
      return true;
    } finally {
      this.pending = false;
    }
  }
}
