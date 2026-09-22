/**
 * @author Codex
 * @description Latches native lifecycle metadata changes so bounded startup and shutdown waits never poll status.
 */
import { watch } from 'node:fs';

export class DirectorySignal {
  #revision = 0;
  #closed = false;
  #failed = false;
  #closing: Promise<void> | undefined;
  readonly #waiters = new Set<() => void>();
  readonly #watcher;
  /**
   * Watches an already initialized profile directory without reading business state.
   */
  constructor(directory: string) {
    this.#watcher = watch(directory, { persistent: false }, (_event, filename) => {
      if (
        filename === null ||
        ['endpoint.json', 'control.json', 'startup-error.json', 'lifecycle.json'].includes(
          filename.toString()
        )
      ) {
        this.#revision++;
        for (const wake of [...this.#waiters]) {
          wake();
        }
      }
    });
    this.#watcher.on('error', () => {
      this.#failed = true;
      void this.close();
    });
  }
  /**
   * Captures an event fence before an authoritative lifecycle read.
   */
  get revision(): number {
    return this.#revision;
  }
  /**
   * Waits for a real change or the caller's fixed deadline, without repeating a request.
   */
  wait(observed: number, deadline: number, signal?: AbortSignal): Promise<void> {
    if (this.#closed) {
      return Promise.reject(new Error('Lifecycle watcher closed.'));
    }
    signal?.throwIfAborted();
    if (observed !== this.#revision) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(done, Math.max(0, deadline - Date.now()));
      /**
       * Removes all resources before resolving a metadata or deadline wakeup.
       */
      function done(): void {
        cleanup();
        resolve();
      }
      /**
       * Preserves the caller's cancellation without waiting for another filesystem event.
       */
      function aborted(): void {
        cleanup();
        const reason: unknown = signal?.reason;
        reject(
          reason instanceof Error ? reason : new DOMException('Lifecycle wait cancelled.', 'AbortError')
        );
      }
      const cleanup = (): void => {
        clearTimeout(timer);
        this.#waiters.delete(done);
        signal?.removeEventListener('abort', aborted);
      };
      this.#waiters.add(done);
      signal?.addEventListener('abort', aborted, { once: true });
    });
  }
  /**
   * Releases the native watch and pending waiters at the lifecycle boundary.
   */
  close(): Promise<void> {
    return (this.#closing ??= (async () => {
      if (this.#closed) {
        return;
      }
      this.#closed = true;
      const closed = this.#failed
        ? Promise.resolve()
        : new Promise<void>((resolve) => this.#watcher.once('close', resolve));
      this.#watcher.close();
      for (const wake of [...this.#waiters]) {
        wake();
      }
      await closed;
    })());
  }
}
