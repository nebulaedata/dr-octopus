/**
 * @author Codex
 * @description Serializes Session runtime admission and enforces global and per-Workspace capacity.
 */

import { SessionRuntimeError } from './errors.js';
import { waitForRuntime } from './deadline.js';
import type { SessionRuntimeDirectory } from './runtime-directory.js';
import type { SessionRuntimeLimits, SessionRuntimeRequestOptions } from './types.js';

/**
 * Protects capacity checks and runtime publication with one admission critical section.
 */
export class SessionRuntimeAdmission {
  readonly #directory: SessionRuntimeDirectory;
  readonly #limits: SessionRuntimeLimits;
  readonly #now: () => number;
  readonly #reclaim: (runtimeId: string) => Promise<void>;
  readonly #maxQueueDepth: number;
  readonly #waitTimeoutMs: number;
  #queueDepth = 0;
  #tail: Promise<void> = Promise.resolve();

  /**
   * Creates an admission policy over the authoritative Session Slot directory.
   *
   * @param directory Authoritative Session Slot directory.
   * @param limits Global and per-Workspace capacity policy.
   * @param now Clock used for deterministic idle selection.
   * @param reclaim Stops and removes a selected runtime.
   */
  public constructor(
    directory: SessionRuntimeDirectory,
    limits: SessionRuntimeLimits,
    now: () => number,
    reclaim: (runtimeId: string) => Promise<void>,
    maxQueueDepth = 128,
    waitTimeoutMs = 30_000
  ) {
    this.#directory = directory;
    this.#limits = limits;
    this.#now = now;
    this.#reclaim = reclaim;
    this.#maxQueueDepth = maxQueueDepth;
    this.#waitTimeoutMs = waitTimeoutMs;
  }

  /**
   * Runs one activation after every earlier admission operation settles.
   *
   * @param operation Activation work protected by the admission critical section.
   * @returns The activation result.
   */
  public async run<T>(operation: () => Promise<T>, request: SessionRuntimeRequestOptions = {}): Promise<T> {
    if (this.#queueDepth >= this.#maxQueueDepth) {
      throw new SessionRuntimeError('SESSION_RUNTIME_QUEUE_FULL', 'Session runtime admission queue is full.');
    }
    this.#queueDepth += 1;
    const previous = this.#tail;
    let release = (): void => undefined;
    this.#tail = new Promise<void>((resolveAdmission) => {
      release = resolveAdmission;
    });
    try {
      await waitForRuntime(previous, request, this.#waitTimeoutMs, this.#now, 'admission wait');
    } catch (error) {
      void previous.finally(release);
      this.#queueDepth -= 1;
      throw error;
    }
    try {
      return await operation();
    } finally {
      this.#queueDepth -= 1;
      release();
    }
  }

  /**
   * Reclaims the oldest safe idle runtime when the active capacity scope is full.
   * The idle TTL is preferred for normal downsizing, but it cannot make a hard
   * capacity limit permanently reject new Sessions while a settled runtime is safe to retire.
   *
   * @param workspaceId Workspace requesting runtime capacity.
   * @throws When no safely reclaimable runtime can satisfy the capacity policy.
   */
  public async ensureCapacity(workspaceId: string): Promise<void> {
    const workspaceExceeded =
      this.#directory.count(workspaceId) >= this.#limits.maxActiveRuntimesPerWorkspace;
    const globalExceeded = this.#directory.count() >= this.#limits.maxActiveRuntimes;
    if (!globalExceeded && !workspaceExceeded) {
      return;
    }
    const expiredCandidateId = this.#directory.claimReclaimable(
      workspaceId,
      workspaceExceeded,
      this.#now(),
      this.#limits.idleTtlMs
    );
    const candidateId =
      expiredCandidateId ?? this.#directory.claimReclaimable(workspaceId, workspaceExceeded, this.#now(), 0);
    if (candidateId === undefined) {
      throw new SessionRuntimeError(
        'SESSION_RUNTIME_CAPACITY',
        'No safely reclaimable Session runtime is available.'
      );
    }
    await this.#reclaim(candidateId);
  }

  /**
   * Returns queued and currently admitted activation demand for diagnostics.
   */
  public getQueueDepth(): number {
    return this.#queueDepth;
  }
}
