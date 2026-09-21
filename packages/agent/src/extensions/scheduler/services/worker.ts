/**
 * @author Codex
 * @description Owns the singleton Scheduler wake loop, capacity, cancellation and bounded Runner shutdown.
 */
import type { SchedulerRunner } from '../definitions/runner.js';
import type { SchedulerExecutionWork, SchedulerWorkDiagnostics } from '../definitions/work.js';
import type { SchedulerWorkRepository } from '../infrastructure/work-repository.js';

export interface SchedulerWorkerStatus extends SchedulerWorkDiagnostics {
  active: boolean;
  degraded: boolean;
  lastScanAt: string | null;
}

/**
 * Use one bounded scan timer; tasks never own timers or process-global listeners.
 */
export class SchedulerWorker {
  private readonly active = new Map<
    string,
    { work: SchedulerExecutionWork; controller: AbortController; promise: Promise<void> }
  >();
  private timer: NodeJS.Timeout | undefined;
  private closing = false;
  private scanning = false;
  private degraded = false;
  private lastScanAt: string | null = null;
  private maxConcurrentRuns = 3;

  /**
   * Inject durable work state, isolated execution and the daemon fence identity.
   */
  constructor(
    private readonly repository: SchedulerWorkRepository,
    private readonly runner: SchedulerRunner,
    private readonly daemonId: string,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly reconcileAuthorization: () => void = () => undefined,
    private readonly onChanged: () => void = () => undefined
  ) {}

  /**
   * Recover previous ownership before admitting claims, then schedule the first scan.
   */
  start(): void {
    const now = this.now();
    this.repository.recoverAbandoned(this.daemonId, now);
    this.wake();
  }

  /**
   * Apply bounded admission capacity without interrupting work already running.
   */
  configure(maxConcurrentRuns: number): void {
    this.maxConcurrentRuns = maxConcurrentRuns;
  }

  /**
   * Coalesce concurrent wake requests and launch work only within repository capacity fences.
   */
  wake(): void {
    if (this.closing || this.scanning) {
      return;
    }
    clearTimeout(this.timer);
    this.scanning = true;
    const now = this.now();
    try {
      this.reconcileAuthorization();
      for (const active of this.active.values()) {
        if (this.repository.cancellationRequested(active.work, this.daemonId)) {
          active.controller.abort();
        }
      }
      this.repository.materialize(now);
      while (this.active.size < this.maxConcurrentRuns) {
        const work = this.repository.claim(this.daemonId, now, this.maxConcurrentRuns);
        if (!work) {
          break;
        }
        this.launch(work);
      }
      this.degraded = false;
      this.lastScanAt = now;
    } catch {
      this.degraded = true;
      for (const active of this.active.values()) {
        active.controller.abort();
      }
    } finally {
      this.scanning = false;
      this.notifyChanged();
      if (!this.closing) {
        this.timer = setTimeout(() => this.wake(), 5000);
      }
    }
  }

  /**
   * Report bounded operational state without prompts, paths or credentials.
   */
  diagnostics(): SchedulerWorkerStatus {
    return {
      active: !this.closing,
      degraded: this.degraded,
      lastScanAt: this.lastScanAt,
      ...this.repository.diagnostics(),
    };
  }

  /**
   * Stop admission, abort owned Runners and wait a bounded interval before returning lifecycle ownership.
   */
  async close(): Promise<void> {
    if (this.closing) {
      return;
    }
    this.closing = true;
    clearTimeout(this.timer);
    for (const active of this.active.values()) {
      active.controller.abort();
    }
    let timeout: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.allSettled([...this.active.values()].map((item) => item.promise)),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, 8000);
      }),
    ]);
    clearTimeout(timeout);
    for (const active of this.active.values()) {
      this.repository.finish(active.work, this.daemonId, this.now(), {
        status: 'interrupted',
        summary: 'Scheduled execution was interrupted while the service stopped.',
        errorCode: 'SCHEDULE_EXECUTION_INTERRUPTED',
      });
    }
  }

  /**
   * Keep observation failures from changing committed execution outcomes or stopping the wake loop.
   */
  private notifyChanged(): void {
    try {
      this.onChanged();
    } catch {
      /* Observers reconcile independently. */
    }
  }

  /**
   * Bind Runner callbacks to exact daemon/attempt persistence fences.
   */
  private launch(work: SchedulerExecutionWork): void {
    const controller = new AbortController();
    const promise = this.runner
      .run(work, controller.signal, {
        dispatch: (evidence) => {
          const accepted =
            !this.closing && this.repository.dispatch(work, this.daemonId, this.now(), evidence);
          if (!accepted) {
            this.repository.abandonClaim(work, this.daemonId, this.now());
          }
          this.notifyChanged();
          return accepted;
        },
        running: (entryId) => {
          const accepted = !this.closing && this.repository.running(work, this.daemonId, entryId, this.now());
          this.notifyChanged();
          return accepted;
        },
      })
      .then((outcome) => {
        this.repository.finish(
          work,
          this.daemonId,
          this.now(),
          this.closing
            ? {
                status: 'interrupted',
                summary: 'Scheduled execution was interrupted while the service stopped.',
                errorCode: 'SCHEDULE_EXECUTION_INTERRUPTED',
              }
            : outcome
        );
      })
      .catch(() => {
        this.degraded = true;
        this.repository.finish(work, this.daemonId, this.now(), {
          status: 'interrupted',
          summary: 'Scheduled execution ended unexpectedly.',
          errorCode: 'SCHEDULE_EXECUTION_INTERRUPTED',
        });
      })
      .finally(() => {
        this.active.delete(work.runId);
        this.notifyChanged();
        if (!this.closing) {
          clearTimeout(this.timer);
          this.timer = setTimeout(() => this.wake(), 0);
        }
      });
    this.active.set(work.runId, { work, controller, promise });
  }
}
