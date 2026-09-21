/**
 * @author Codex
 * @description Validates source-bound completion delivery reads, acknowledgement and retry deferral.
 */
import { SchedulerTaskError } from '../definitions/task-error.js';
import type { SchedulerDeliveryRepository } from '../infrastructure/delivery-repository.js';

/**
 * Keep delivery rules independent of Pi events and HTTP transport.
 */
export class SchedulerDeliveryService {
  /**
   * Inject daemon persistence and clock.
   */
  constructor(
    private readonly repository: SchedulerDeliveryRepository,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  /**
   * List pending work only for a concrete source Session owner.
   */
  listPending(originSessionRef: string) {
    this.validateOrigin(originSessionRef);
    return { items: this.repository.listPending(originSessionRef, this.now()) };
  }

  /**
   * Confirm a durable source entry using an idempotent state transition.
   */
  ack(originSessionRef: string, deliveryId: string, originEntryId: string) {
    this.validateOrigin(originSessionRef);
    if (!deliveryId || deliveryId.length > 100 || !originEntryId || originEntryId.length > 200) {
      throw this.invalid();
    }
    return this.repository.ack(originSessionRef, deliveryId, originEntryId, this.now());
  }

  /**
   * Retain temporary failures with a bounded future retry instant and safe error code.
   */
  defer(originSessionRef: string, deliveryId: string, availableAt: string, errorCode: string) {
    this.validateOrigin(originSessionRef);
    const retryAt = Date.parse(availableAt);
    const current = Date.parse(this.now());
    if (
      !deliveryId ||
      deliveryId.length > 100 ||
      !Number.isFinite(retryAt) ||
      retryAt <= current ||
      retryAt > current + 86_400_000 ||
      !/^[A-Z0-9_]{1,100}$/.test(errorCode)
    ) {
      throw this.invalid();
    }
    return this.repository.defer(originSessionRef, deliveryId, new Date(retryAt).toISOString(), errorCode);
  }

  /**
   * Reject empty or oversized Session identities without echoing them.
   */
  private validateOrigin(originSessionRef: string): void {
    if (!originSessionRef || originSessionRef.length > 500) {
      throw this.invalid();
    }
  }

  /**
   * Return one stable validation failure for malformed delivery commands.
   */
  private invalid(): SchedulerTaskError {
    return new SchedulerTaskError('SCHEDULE_INVALID', 'Invalid scheduler delivery request');
  }
}
