/**
 * @author Codex
 * @description Binds a physical Escape watcher to one Computer activity and Runtime identity, retiring callbacks on idle, restart and disposal.
 */
import type { RuntimeSnapshot } from '../contracts/runtime';
import { createRequire } from 'node:module';

type EscapeWatcher = {
  /**
   * Starts one physical Escape-only subscription and resolves after native registration.
   */
  start(onEscape: () => void): Promise<void>;
  /**
   * Retires the owned subscription and suppresses already queued notifications.
   */
  stop(): void;
};

export class ComputerUseEscape {
  private binding: { activityId: string; pid: number | null } | null = null;
  private failed: { activityId: string; pid: number | null } | null = null;
  private disposed = false;

  /**
   * Loads only the Host-selected fixed native resource; the helper exposes no configurable key or process target.
   */
  static open(
    nativePath: string,
    stopComputer: (activityId: string, pid: number | null) => void
  ): ComputerUseEscape {
    const watcher = createRequire(import.meta.url)(nativePath) as EscapeWatcher;
    if (typeof watcher.start !== 'function' || typeof watcher.stop !== 'function') {
      throw new Error('COMPUTER_ESCAPE_UNAVAILABLE');
    }
    return new ComputerUseEscape(watcher, stopComputer);
  }

  /**
   * Takes only a fixed native helper and a Main-owned stop operation, never Renderer commands.
   */
  constructor(
    private readonly watcher: EscapeWatcher,
    private readonly stopComputer: (activityId: string, pid: number | null) => void
  ) {}

  /**
   * Watches only active/unknown Computer use; per-call revision changes do not create additional subscriptions.
   */
  update(snapshot: RuntimeSnapshot): void {
    if (this.disposed) {
      return;
    }
    const { activityId, state } = snapshot.computerUse;
    if (!activityId || state === 'idle') {
      this.failed = null;
      this.retire();
      return;
    }
    if (this.failed?.activityId === activityId && this.failed.pid === snapshot.pid) {
      return;
    }
    if (this.binding?.activityId === activityId && this.binding.pid === snapshot.pid) {
      return;
    }
    this.retire();
    const binding = { activityId, pid: snapshot.pid };
    this.failed = null;
    this.binding = binding;
    try {
      void this.watcher
        .start(() => {
          if (!this.disposed && this.binding === binding) {
            this.stopComputer(binding.activityId, binding.pid);
          }
        })
        .catch(() => {
          if (this.binding === binding) {
            this.failed = binding;
            this.retire();
            console.error('[executor] Escape stop unavailable; use the tray desktop-stop action.');
          }
        });
    } catch {
      this.failed = binding;
      this.retire();
      console.error('[executor] Escape stop unavailable; use the tray desktop-stop action.');
    }
  }

  /**
   * Suppresses late callbacks before releasing the current native watcher.
   */
  private retire(): void {
    this.binding = null;
    this.watcher.stop();
  }

  /**
   * Releases only this owner's watcher; repeated cleanup is harmless.
   */
  dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      this.retire();
    }
  }
}
