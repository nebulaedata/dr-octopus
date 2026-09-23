/**
 * @author Codex
 * @description Completes ordered runtime teardown through the owning Session Runtime Slot.
 */

import type { AgentProcessManager } from '@octopus/agent/rpc';
import type { ManagedSessionRuntime } from './managed-session.js';
import type { SessionRuntimeDirectory } from './runtime-directory.js';
import type { SessionRuntimeSlot } from './runtime-slot.js';

/**
 * Owns graceful drain and process cleanup while Slot retirement provides single-flight semantics.
 */
export class SessionRuntimeRetirement {
  /**
   * Creates retirement orchestration over the sole Slot directory and process supervisor.
   */
  public constructor(
    private readonly manager: AgentProcessManager,
    private readonly directory: SessionRuntimeDirectory,
    private readonly drainTimeoutMs = 10_000
  ) {}

  /**
   * Stops one runtime once and retains its Slot in draining state until process exit completes.
   */
  public stop(runtimeId: string): Promise<void> {
    const slot = this.directory.findByRuntimeId(runtimeId);
    if (slot === undefined) {
      return Promise.resolve();
    }
    const existing = slot.getRetirement();
    if (existing !== undefined) {
      return existing;
    }
    const runtime = slot.beginDrain(runtimeId, true);
    if (runtime === undefined) {
      return Promise.resolve();
    }
    const retirement = this.#finish(slot, runtimeId, runtime);
    slot.setRetirement(runtimeId, retirement);
    return retirement;
  }

  /**
   * Stops every resident runtime before closing the process supervisor.
   */
  public async close(): Promise<void> {
    try {
      await this.directory.settleActivations();
      await Promise.all(this.directory.runtimeIds().map(async (runtimeId) => this.stop(runtimeId)));
    } finally {
      await this.manager.stopAll();
    }
  }

  /**
   * Drains accepted operations, stops the child process, and clears the exact Slot generation.
   */
  async #finish(slot: SessionRuntimeSlot, runtimeId: string, runtime: ManagedSessionRuntime): Promise<void> {
    await runtime.waitForDrain(this.drainTimeoutMs);
    try {
      await this.manager.stop(runtimeId);
    } catch (error) {
      slot.lifecycle.markUnsafe();
      throw error;
    }
    runtime.dispose();
    slot.retire(runtimeId);
  }
}
