/**
 * @author Codex
 * @description Implements a scoped Session runtime operation that cannot outlive its acquired lease.
 */

import { SessionRuntimeError } from './errors.js';
import type { ManagedSessionRuntime } from './managed-session.js';
import type { ManagedSessionCommand, SessionRuntimeBinding } from './types.js';
import type { RpcExtensionUIResponse } from '@earendil-works/pi-coding-agent';
import type { PermissionMode, PermissionStateDto } from '@octopus/shared/protocol';

export class SessionRuntimeOperation {
  public readonly binding: SessionRuntimeBinding;
  public readonly epoch: number;
  readonly #runtime: ManagedSessionRuntime;
  readonly #releaseRuntime: () => void;
  readonly #assertFence: () => void;
  #active = true;

  /**
   * Acquires one managed runtime and freezes its generation identity for this operation.
   */
  public constructor(runtime: ManagedSessionRuntime, epoch: number, assertFence: () => void) {
    this.#runtime = runtime;
    this.#releaseRuntime = runtime.acquireOperation();
    this.binding = Object.freeze({ ...runtime.getBinding() });
    this.epoch = epoch;
    this.#assertFence = assertFence;
  }

  /**
   * Executes an allowed command while this operation owns its runtime lease.
   */
  public async execute(command: ManagedSessionCommand): Promise<unknown> {
    this.#assertActive();
    return this.#runtime.execute(command);
  }

  /**
   * Reads current runtime state under this operation's generation fence.
   * Snapshot callers must read this after asynchronous work, alongside their event sequence.
   * @returns Current binding rather than the state captured when the lease was acquired.
   * @throws SessionRuntimeError when the operation is released or its generation is stale.
   */
  public getCurrentBinding(): SessionRuntimeBinding {
    this.#assertActive();
    return this.#runtime.getBinding();
  }

  /**
   * Routes one Extension UI response while this operation owns its runtime lease.
   */
  public async respondToExtensionUi(response: RpcExtensionUIResponse): Promise<void> {
    this.#assertActive();
    await this.#runtime.respondToExtensionUi(response);
  }

  /**
   * Reads permission state while this operation owns its runtime lease.
   */
  public async getPermissionState(): Promise<PermissionStateDto> {
    this.#assertActive();
    return this.#runtime.getPermissionState();
  }

  /**
   * Changes permission mode while this operation owns its runtime lease.
   *
   * @param mode Requested permission mode.
   */
  public async setPermissionMode(mode: PermissionMode): Promise<PermissionStateDto> {
    this.#assertActive();
    return this.#runtime.setPermissionMode(mode);
  }

  /**
   * Invalidates this handle and releases its runtime operation lease once.
   */
  public release(): void {
    if (!this.#active) {
      return;
    }
    this.#active = false;
    this.#releaseRuntime();
  }

  /**
   * Prevents a retained operation from accessing a released runtime generation.
   */
  #assertActive(): void {
    if (!this.#active) {
      throw new SessionRuntimeError(
        'SESSION_RUNTIME_STALE',
        `Session runtime operation has already been released: ${this.binding.runtimeId}`
      );
    }
    this.#assertFence();
  }
}
