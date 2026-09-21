/**
 * @author Codex
 * @description Single-flight source Session completion reconciliation with evidence-before-ack semantics.
 */
import type {
  SchedulerDelivery,
  SchedulerDeliveryPort,
  SchedulerOriginSessionPort,
} from '../definitions/delivery.js';

/**
 * Own polling, deduplication, persistence checks, acknowledgement and retry policy.
 */
export class SchedulerResultDelivery {
  private readonly controller = new AbortController();
  private running: Promise<void> | undefined;
  private rerun = false;
  private timer: NodeJS.Timeout | undefined;

  /**
   * Inject narrow daemon and current Session ports.
   */
  constructor(
    private readonly deliveries: SchedulerDeliveryPort,
    private readonly origin: SchedulerOriginSessionPort,
    private readonly now: () => number = Date.now
  ) {}

  /**
   * Start low-frequency polling and perform the initial offline catch-up.
   */
  start(): void {
    void this.reconcile('session-start');
    this.schedule();
  }

  /**
   * Merge concurrent event triggers and retain at most one follow-up reconciliation.
   */
  reconcile(reason: string): Promise<void> {
    void reason;
    if (this.controller.signal.aborted) {
      return Promise.resolve();
    }
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = this.drain().finally(() => {
      this.running = undefined;
      if (this.rerun && !this.controller.signal.aborted) {
        this.rerun = false;
        void this.reconcile('coalesced');
      }
    });
    return this.running;
  }

  /**
   * Stop polling and abort transport requests without changing pending delivery facts.
   */
  dispose(): void {
    clearTimeout(this.timer);
    this.controller.abort();
  }

  /**
   * Process one bounded page in order, proving append evidence before each acknowledgement.
   */
  private async drain(): Promise<void> {
    if (!this.origin.isReady()) {
      return;
    }
    const lease = await this.deliveries.acquireLease().catch(() => null);
    if (!lease) {
      return;
    }
    try {
      await this.drainOwned();
    } finally {
      lease.release();
    }
  }

  /**
   * Reconcile while holding the source Session fence across evidence lookup, append and acknowledgement.
   */
  private async drainOwned(): Promise<void> {
    if (!this.origin.isReady()) {
      return;
    }
    let page: Awaited<ReturnType<SchedulerDeliveryPort['listPending']>>;
    try {
      page = await this.deliveries.listPending(this.controller.signal);
    } catch {
      return;
    }
    for (const delivery of page.items) {
      if (this.controller.signal.aborted || !this.origin.isReady()) {
        return;
      }
      const existing = this.origin.findEvidence(delivery.id);
      if (existing) {
        await this.ack(delivery, existing);
        continue;
      }
      try {
        const appended = this.origin.append(delivery);
        const evidence = appended ?? this.origin.findEvidence(delivery.id);
        if (!evidence) {
          await this.defer(delivery, 'SCHEDULE_DELIVERY_EVIDENCE_PENDING');
          continue;
        }
        await this.ack(delivery, evidence);
      } catch {
        await this.defer(delivery, 'SCHEDULE_DELIVERY_WRITE_FAILED');
      }
    }
  }

  /**
   * Ack can be replayed safely when the response is lost after daemon commit.
   */
  private async ack(delivery: SchedulerDelivery, entryId: string): Promise<void> {
    await this.deliveries.ack(delivery.id, entryId, this.controller.signal).catch(() => undefined);
  }

  /**
   * Apply bounded exponential backoff while leaving the delivery pending.
   */
  private async defer(delivery: SchedulerDelivery, errorCode: string): Promise<void> {
    const delay = Math.min(300_000, 5000 * 2 ** Math.min(delivery.attempts, 6));
    await this.deliveries
      .defer(delivery.id, new Date(this.now() + delay).toISOString(), errorCode, this.controller.signal)
      .catch(() => undefined);
  }

  /**
   * Poll slowly; event hooks provide fast reconciliation when the source becomes idle.
   */
  private schedule(): void {
    clearTimeout(this.timer);
    if (this.controller.signal.aborted) {
      return;
    }
    this.timer = setTimeout(() => {
      void this.reconcile('poll').finally(() => this.schedule());
    }, 30_000);
  }
}
