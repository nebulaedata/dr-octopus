/**
 * @author Codex
 * @description Tracks admitted Computer tasks, in-flight calls and unresolved outcomes independently of transport connectivity and UI lifetime.
 */
import { randomUUID } from 'node:crypto';
import type { ComputerUseSnapshot } from '../../contracts/computer-use';

export class ComputerUseActivity {
  private revision = 0;
  private activityId: string | null = null;
  private calls = new Map<symbol, boolean>();
  private tasks = new Set<string>();

  /**
   * Keeps feedback visible throughout an admitted Computer task, including observation and pauses between calls.
   * @throws If the finite session limit is exceeded.
   */
  startTask(taskId: string): void {
    if (this.tasks.has(taskId)) {
      return;
    }
    if (this.tasks.size >= 32) {
      throw new Error('COMPUTER_ACTIVITY_BUSY');
    }
    this.tasks.add(taskId);
    this.emit();
  }

  /**
   * Ends only this task's feedback; in-flight and unresolved calls still retain their independent signal.
   */
  endTask(taskId: string): void {
    if (this.tasks.delete(taskId)) {
      this.emit();
    }
  }

  /**
   * Releases session feedback only after the owning backend has confirmed shutdown.
   */
  endTasks(): void {
    if (this.tasks.size) {
      this.tasks.clear();
      this.emit();
    }
  }

  /**
   * Publishes detached evidence to the owning Runtime; the callback does not expose an execution interface.
   */
  constructor(
    private readonly publish: (snapshot: ComputerUseSnapshot) => void,
    private readonly confirmVisible?: (revision: number) => Promise<void>
  ) {}

  /**
   * Starts feedback only at trusted dispatch admission, never at connect/listTools or agent planning time.
   * @returns A per-call completion handle; repeated completion is harmless and unknown outcomes retain feedback.
   * @throws If admitted calls exceed the finite call limit.
   */
  begin(): { ready: () => Promise<void>; complete: () => void; uncertain: () => void } {
    if (this.calls.size >= 32) {
      throw new Error('COMPUTER_ACTIVITY_BUSY');
    }
    const id = Symbol('computer-call');
    this.calls.set(id, false);
    this.emit();
    const revision = this.revision;
    return {
      /**
       * Requires trusted Host evidence that this revision's feedback is visible before any desktop input dispatch.
       */
      ready: () =>
        this.confirmVisible
          ? this.confirmVisible(revision)
          : Promise.reject(new Error('COMPUTER_INDICATOR_UNAVAILABLE')),
      /**
       * Releases this call only after an actual backend result or confirmed local cleanup.
       */
      complete: () => {
        if (this.calls.delete(id)) {
          this.emit();
        }
      },
      /**
       * Retains the signal when timeout/transport loss cannot establish that input execution stopped.
       */
      uncertain: () => {
        if (this.calls.has(id) && !this.calls.get(id)) {
          this.calls.set(id, true);
          this.emit();
        }
      },
    };
  }

  /**
   * Returns detached aggregate state; one completed call cannot hide another active or uncertain call.
   */
  snapshot(): ComputerUseSnapshot {
    let state: ComputerUseSnapshot['state'] = 'idle';
    if ([...this.calls.values()].some(Boolean)) {
      state = 'unknown';
    } else if (this.calls.size + this.tasks.size > 0) {
      state = 'running';
    }
    return {
      revision: this.revision,
      activityId: this.activityId,
      activeCalls: this.calls.size,
      activeTasks: this.tasks.size,
      state,
    };
  }

  /**
   * Advances one monotonic Runtime revision per actual activity transition.
   */
  private emit(): void {
    if (this.calls.size + this.tasks.size === 0) {
      this.activityId = null;
    } else {
      this.activityId ??= randomUUID();
    }
    this.revision++;
    this.publish(this.snapshot());
  }
}
