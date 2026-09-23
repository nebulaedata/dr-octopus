/**
 * @author Codex
 * @description Retains generation-fenced restart intent and wakes it only on runtime safety changes.
 */
import type { SessionRuntimeBinding } from './types.js';

interface PendingRestart {
  running: boolean;
  revision: number;
  /**
   * Performs the restart under the existing lifecycle fence.
   */
  run(): Promise<SessionRuntimeBinding>;
}
export class DeferredRestarts {
  readonly #pending = new Map<string, PendingRestart>();
  /**
   * Keeps admission and notification owned by the Coordinator; this queue owns no timers or transport.
   */
  constructor(
    private readonly ready: (sessionId: string) => boolean,
    private readonly changed: (sessionId: string) => void
  ) {}
  /**
   * Reports intent, including an in-flight deferred attempt.
   */
  has(id: string): boolean {
    return this.#pending.has(id);
  }
  /**
   * Coalesces requests for the current fenced generation.
   */
  enqueue(id: string, run: PendingRestart['run']): void {
    if (!this.#pending.has(id)) {
      this.#pending.set(id, { running: false, revision: 0, run });
    }
    this.changed(id);
    this.wake(id);
  }
  /**
   * Rechecks at the event boundary; failed busy checks wait for the next safety event.
   */
  wake(id: string): void {
    const pending = this.#pending.get(id);
    if (pending) {
      pending.revision++;
    }
    if (!pending || pending.running || !this.ready(id)) {
      return;
    }
    pending.running = true;
    const observed = pending.revision;
    void Promise.resolve()
      .then(async () => {
        if (this.#pending.get(id) !== pending) {
          return;
        }
        await pending.run();
        if (this.#pending.get(id) === pending) {
          this.cancel(id);
        }
      })
      .catch((error: unknown) => {
        if (this.#pending.get(id) !== pending) {
          return;
        }
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'SESSION_BUSY') {
          pending.running = false;
          // Only compensate for an actual safety event that arrived during this attempt.
          if (pending.revision !== observed) {
            queueMicrotask(() => this.wake(id));
          }
        } else {
          this.cancel(id);
        }
      });
  }
  /**
   * Cancels stale intent when the user restarts immediately or deletes the Session.
   */
  cancel(id: string): void {
    if (this.#pending.delete(id)) {
      this.changed(id);
    }
  }
  /**
   * Prevents deferred work after Coordinator shutdown.
   */
  close(): void {
    this.#pending.clear();
  }
}
