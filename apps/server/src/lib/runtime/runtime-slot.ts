/**
 * @author Codex
 * @description Owns one Session's activation Promise, runtime generation, retirement, demand, and epoch.
 */

import { SessionRuntimeError } from './errors.js';
import { SessionLifecycleControl } from './session-lifecycle-control.js';
import type { ManagedSessionRuntime } from './managed-session.js';
import type { SessionRuntimeSlotSnapshot } from './types.js';

export type SessionRuntimeSlotState = 'empty' | 'activating' | 'active' | 'draining';

/**
 * Represents the single authoritative in-process ownership cell for one Web Session.
 */
export class SessionRuntimeSlot {
  public readonly lifecycle = new SessionLifecycleControl();
  readonly #sessionId: string;
  #canonicalSessionPath: string | undefined;
  #activation: Promise<ManagedSessionRuntime> | undefined;
  #retirement: Promise<void> | undefined;
  #runtime: ManagedSessionRuntime | undefined;
  #demandCount = 0;
  #epoch = 0;
  #state: SessionRuntimeSlotState = 'empty';

  /**
   * Creates one stable Slot whose epoch survives runtime retirement.
   *
   * @param sessionId Stable Web Session identity.
   * @param canonicalSessionPath Optional canonical Pi Session path when already known.
   */
  public constructor(sessionId: string, canonicalSessionPath?: string) {
    this.#sessionId = sessionId;
    this.#canonicalSessionPath = canonicalSessionPath;
  }

  /**
   * Binds and validates the immutable Pi Session path represented by this Slot.
   */
  public bindCanonicalSessionPath(canonicalSessionPath: string): void {
    if (this.#canonicalSessionPath !== undefined && this.#canonicalSessionPath !== canonicalSessionPath) {
      throw new SessionRuntimeError(
        'SESSION_RUNTIME_BINDING_MISMATCH',
        `Session Slot is already bound to another path: ${this.#sessionId}`
      );
    }
    this.#canonicalSessionPath = canonicalSessionPath;
  }

  /**
   * Registers caller interest before asynchronous activation or capacity work begins.
   *
   * @returns Idempotent callback that releases demand exactly once.
   */
  public acquireDemand(): () => void {
    this.#demandCount += 1;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.#demandCount -= 1;
    };
  }

  /**
   * Returns the active runtime, shares an in-progress activation, or waits for retirement before restarting.
   *
   * @param factory Creates the next runtime generation using the reserved Slot epoch.
   */
  public activate(
    factory: (epoch: number) => Promise<ManagedSessionRuntime>
  ): Promise<ManagedSessionRuntime> {
    if (this.#state === 'active' && this.#runtime !== undefined) {
      return Promise.resolve(this.#runtime);
    }
    if (this.#state === 'activating' && this.#activation !== undefined) {
      return this.#activation;
    }
    if (this.#state === 'draining') {
      if (this.#retirement === undefined) {
        throw new SessionRuntimeError(
          'SESSION_RUNTIME_STALE',
          `Session runtime is draining without a retirement owner: ${this.#sessionId}`
        );
      }
      return this.#retirement.then(() => this.activate(factory));
    }

    this.#state = 'activating';
    const nextEpoch = this.#epoch + 1;
    const activation = Promise.resolve()
      .then(() => factory(nextEpoch))
      .then((runtime) => {
        const binding = runtime.getBinding();
        if (binding.sessionId !== this.#sessionId || binding.epoch !== nextEpoch) {
          throw new SessionRuntimeError(
            'SESSION_RUNTIME_BINDING_MISMATCH',
            `Activated runtime does not match Session Slot: ${this.#sessionId}`
          );
        }
        this.bindCanonicalSessionPath(binding.sessionPath);
        this.#runtime = runtime;
        this.#epoch = nextEpoch;
        this.#state = 'active';
        runtime.start();
        this.#activation = undefined;
        return runtime;
      })
      .catch((error: unknown) => {
        if (this.#activation === activation) {
          this.#runtime?.dispose();
          this.#runtime = undefined;
          this.#activation = undefined;
          this.#state = 'empty';
        }
        throw error;
      });
    this.#activation = activation;
    return activation;
  }

  /**
   * Claims the active generation for retirement when its demand and runtime safety gates allow it.
   *
   * @param runtimeId Candidate runtime generation.
   * @param force Whether an explicit administrative stop may ignore Slot demand.
   * @returns Claimed runtime, or undefined when the generation cannot be drained.
   */
  public beginDrain(runtimeId: string, force = false): ManagedSessionRuntime | undefined {
    if (this.#state === 'draining' && this.#runtime?.getBinding().runtimeId === runtimeId) {
      return this.#runtime;
    }
    if (
      this.#state !== 'active' ||
      this.#runtime?.getBinding().runtimeId !== runtimeId ||
      (!force && this.#demandCount !== 0)
    ) {
      return undefined;
    }
    if (force) {
      this.#runtime.beginStop();
    } else if (!this.#runtime.tryBeginReclaim()) {
      return undefined;
    }
    this.#state = 'draining';
    return this.#runtime;
  }

  /**
   * Publishes the single-flight teardown Promise for a claimed generation.
   */
  public setRetirement(runtimeId: string, retirement: Promise<void>): void {
    if (this.#state !== 'draining' || this.#runtime?.getBinding().runtimeId !== runtimeId) {
      throw new SessionRuntimeError(
        'SESSION_RUNTIME_STALE',
        `Cannot retire a generation that does not own the Slot: ${runtimeId}`
      );
    }
    this.#retirement = retirement;
  }

  /**
   * Clears a retired generation while retaining the Slot and its monotonic epoch.
   */
  public retire(runtimeId: string): void {
    if (this.#runtime?.getBinding().runtimeId !== runtimeId) {
      return;
    }
    this.#runtime = undefined;
    this.#retirement = undefined;
    this.#state = 'empty';
  }

  /**
   * Rejects operations whose runtime generation no longer owns this Slot.
   */
  public assertFence(runtimeId: string, epoch: number): void {
    this.lifecycle.assertAvailable();
    if (
      this.#state !== 'active' ||
      this.#runtime?.getBinding().runtimeId !== runtimeId ||
      this.#epoch !== epoch
    ) {
      throw new SessionRuntimeError(
        'SESSION_RUNTIME_BINDING_MISMATCH',
        `Session runtime generation is stale: ${runtimeId}`
      );
    }
  }

  /**
   * Returns the current runtime in either active or draining state.
   */
  public getRuntime(): ManagedSessionRuntime | undefined {
    return this.#runtime;
  }

  /**
   * Returns an in-progress retirement Promise when teardown owns this Slot.
   */
  public getRetirement(): Promise<void> | undefined {
    return this.#retirement;
  }

  /**
   * Waits for a startup already owned by this Slot, ignoring its outcome during shutdown.
   */
  public async settleActivation(): Promise<void> {
    try {
      await this.#activation;
    } catch {
      // The activation caller owns the failure; shutdown only needs startup to settle.
    }
  }

  /**
   * Returns the stable Web Session identity used by the containing directory.
   */
  public getSessionId(): string {
    return this.#sessionId;
  }

  /**
   * Returns the canonical Pi Session path when activation has resolved it.
   */
  public getCanonicalSessionPath(): string | undefined {
    return this.#canonicalSessionPath;
  }

  /**
   * Returns the current lifecycle state for diagnostics and deterministic tests.
   */
  public getState(): SessionRuntimeSlotState {
    return this.#state;
  }

  /**
   * Returns a read-only ownership snapshot for health checks and leak detection.
   */
  public getSnapshot(): SessionRuntimeSlotSnapshot {
    const runtimeId = this.#runtime?.getBinding().runtimeId;
    return {
      sessionId: this.#sessionId,
      state: this.#state,
      demandCount: this.#demandCount,
      epoch: this.#epoch,
      ...(this.#canonicalSessionPath === undefined
        ? {}
        : { canonicalSessionPath: this.#canonicalSessionPath }),
      ...(runtimeId === undefined ? {} : { runtimeId }),
    };
  }
}
