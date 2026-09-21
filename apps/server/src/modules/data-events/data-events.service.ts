/**
 * @author Codex
 * @description Coalesces process-local business invalidations without retaining business snapshots.
 */
import type { DataChange } from '@octopus/shared/protocol';

export class DataEventsService {
  private readonly listeners = new Set<(change: DataChange) => void>();
  private readonly pending = new Map<string, DataChange>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  /**
   * Queue a hint for delivery after the current synchronous transaction has completed.
   */
  publish(change: DataChange): void {
    if (this.closed || !this.listeners.size) {
      return;
    }
    this.pending.set(JSON.stringify([change.resource, change.workspaceId]), change);
    this.timer ??= setTimeout(() => this.flush(), 100);
    this.timer.unref();
  }

  /**
   * Subscribe before sending ready so subsequent snapshots cannot miss an intervening mutation.
   */
  subscribe(listener: (change: DataChange) => void): () => void {
    if (this.closed) {
      return () => undefined;
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Drop pending hints and listeners during Host shutdown.
   */
  close(): void {
    this.closed = true;
    clearTimeout(this.timer);
    this.pending.clear();
    this.listeners.clear();
  }

  /**
   * Isolate failed consumers from committed business operations and other subscribers.
   */
  private flush(): void {
    this.timer = undefined;
    const changes = [...this.pending.values()];
    this.pending.clear();
    for (const change of changes) {
      for (const listener of this.listeners) {
        try {
          listener(change);
        } catch {
          this.listeners.delete(listener);
        }
      }
    }
  }
}
