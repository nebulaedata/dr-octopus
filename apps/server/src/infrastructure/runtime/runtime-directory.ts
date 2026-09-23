/**
 * @author Codex
 * @description Provides the single authoritative in-process directory for Session Runtime Slots.
 */

import { areCanonicalPathsEqual } from '../filesystem/path-identity.js';
import { SessionRuntimeError } from './errors.js';
import { SessionRuntimeSlot } from './runtime-slot.js';
import type { ManagedSessionRuntime } from './managed-session.js';
import type { SessionRuntimeBinding, SessionRuntimeSlotSnapshot } from './types.js';

/**
 * Maps stable Web Session identities directly to their complete runtime ownership Slot.
 */
export class SessionRuntimeDirectory {
  readonly #slots = new Map<string, SessionRuntimeSlot>();

  /**
   * Reads an existing ownership cell without allocating state for dormant catalog queries.
   */
  public get(sessionId: string): SessionRuntimeSlot | undefined {
    return this.#slots.get(sessionId);
  }

  /**
   * Resolves or creates the sole ownership Slot for one Web Session.
   */
  public getOrCreate(sessionId: string): SessionRuntimeSlot {
    const existing = this.#slots.get(sessionId);
    if (existing !== undefined) {
      return existing;
    }
    const slot = new SessionRuntimeSlot(sessionId);
    this.#slots.set(sessionId, slot);
    return slot;
  }

  /**
   * Binds a canonical path after rejecting another resident Slot that already owns it.
   */
  public bindCanonicalSessionPath(slot: SessionRuntimeSlot, canonicalSessionPath: string): void {
    for (const candidate of this.#slots.values()) {
      const candidatePath = candidate.getCanonicalSessionPath();
      if (
        candidate !== slot &&
        candidatePath !== undefined &&
        areCanonicalPathsEqual(candidatePath, canonicalSessionPath)
      ) {
        throw new SessionRuntimeError(
          'SESSION_RUNTIME_BINDING_MISMATCH',
          `Pi Session path is already owned by another Session: ${canonicalSessionPath}`
        );
      }
    }
    slot.bindCanonicalSessionPath(canonicalSessionPath);
  }

  /**
   * Resolves a resident Slot by runtime generation identity.
   */
  public findByRuntimeId(runtimeId: string): SessionRuntimeSlot | undefined {
    return [...this.#slots.values()].find((slot) => slot.getRuntime()?.getBinding().runtimeId === runtimeId);
  }

  /**
   * Requires a resident runtime generation.
   */
  public requireRuntime(runtimeId: string): ManagedSessionRuntime {
    const runtime = this.findByRuntimeId(runtimeId)?.getRuntime();
    if (runtime === undefined) {
      throw new SessionRuntimeError(
        'SESSION_RUNTIME_STALE',
        `Session runtime generation was not found: ${runtimeId}`
      );
    }
    return runtime;
  }

  /**
   * Resolves the runtime currently bound to a stable Web Session identity.
   */
  public getRuntimeBySessionId(sessionId: string): ManagedSessionRuntime | undefined {
    return this.#slots.get(sessionId)?.getRuntime();
  }

  /**
   * Lists resident runtime bindings for one Workspace without maintaining a secondary index.
   */
  public listWorkspace(workspaceId: string): SessionRuntimeBinding[] {
    return this.#residentRuntimes()
      .map((runtime) => runtime.getBinding())
      .filter((binding) => binding.workspaceId === workspaceId);
  }

  /**
   * Counts resident runtime generations globally or within one Workspace.
   */
  public count(workspaceId?: string): number {
    if (workspaceId === undefined) {
      return this.#residentRuntimes().length;
    }
    return this.listWorkspace(workspaceId).length;
  }

  /**
   * Atomically claims the oldest safe runtime matching a capacity scope.
   */
  public claimReclaimable(
    workspaceId: string,
    workspaceOnly: boolean,
    now: number,
    idleTtlMs: number
  ): string | undefined {
    const candidates = [...this.#slots.values()]
      .filter((slot) => {
        const runtime = slot.getRuntime();
        if (slot.getState() !== 'active' || runtime === undefined) {
          return false;
        }
        const binding = runtime.getBinding();
        return (
          (!workspaceOnly || binding.workspaceId === workspaceId) &&
          runtime.isSafelyReclaimable() &&
          now - binding.lastActiveAt >= idleTtlMs
        );
      })
      .sort((left, right) => {
        const leftActiveAt = left.getRuntime()?.getBinding().lastActiveAt ?? 0;
        const rightActiveAt = right.getRuntime()?.getBinding().lastActiveAt ?? 0;
        return leftActiveAt - rightActiveAt;
      });
    for (const slot of candidates) {
      const runtimeId = slot.getRuntime()?.getBinding().runtimeId;
      if (runtimeId !== undefined && slot.beginDrain(runtimeId) !== undefined) {
        return runtimeId;
      }
    }
    return undefined;
  }

  /**
   * Rejects a command whose generation token no longer owns its Session Slot.
   */
  public assertFence(sessionId: string, runtimeId: string, epoch: number): void {
    const slot = this.#slots.get(sessionId);
    if (slot === undefined) {
      throw new SessionRuntimeError('SESSION_RUNTIME_STALE', 'Session runtime Slot is unavailable.');
    }
    slot.assertFence(runtimeId, epoch);
  }

  /**
   * Lists runtime identities that still require shutdown.
   */
  public runtimeIds(): string[] {
    return this.#residentRuntimes().map((runtime) => runtime.getBinding().runtimeId);
  }

  /**
   * Waits for every activation that entered before the Coordinator shutdown gate closed.
   */
  public async settleActivations(): Promise<void> {
    await Promise.all([...this.#slots.values()].map(async (slot) => slot.settleActivation()));
  }

  /**
   * Lists immutable Slot snapshots without exposing lifecycle mutation methods.
   */
  public getSnapshots(): SessionRuntimeSlotSnapshot[] {
    return [...this.#slots.values()].map((slot) => slot.getSnapshot());
  }

  /**
   * Collects each resident runtime exactly once from the authoritative Slot map.
   */
  #residentRuntimes(): ManagedSessionRuntime[] {
    return [...this.#slots.values()].flatMap((slot) => {
      const runtime = slot.getRuntime();
      return runtime === undefined ? [] : [runtime];
    });
  }
}
