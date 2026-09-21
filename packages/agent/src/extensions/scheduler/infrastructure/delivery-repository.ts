/**
 * @author Codex
 * @description SQLite pending-delivery queries and idempotent acknowledgement transitions.
 */
import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { SchedulerTaskError } from '../definitions/task-error.js';
import { resultDeliveries, runs, tasks } from './schema.js';
import type { SchedulerDelivery, SchedulerDeliveryReceipt } from '../definitions/delivery.js';
import type { SchedulerDatabase } from './database.js';

/**
 * Keep source-scoped delivery state behind the daemon's database boundary.
 */
export class SchedulerDeliveryRepository {
  /**
   * Reuse the singleton daemon connection.
   */
  constructor(private readonly database: SchedulerDatabase) {}

  /**
   * Read at most twenty due items in deterministic insertion order.
   */
  listPending(originSessionRef: string, now: string): SchedulerDelivery[] {
    return this.database.db
      .select({ delivery: resultDeliveries, run: runs, taskName: tasks.name })
      .from(resultDeliveries)
      .innerJoin(runs, eq(runs.id, resultDeliveries.runId))
      .innerJoin(tasks, eq(tasks.id, runs.taskId))
      .where(
        and(
          eq(resultDeliveries.originSessionRef, originSessionRef),
          eq(resultDeliveries.status, 'pending'),
          lte(resultDeliveries.availableAt, now)
        )
      )
      .orderBy(asc(resultDeliveries.createdAt), asc(resultDeliveries.id))
      .limit(20)
      .all()
      .map(({ delivery, run, taskName }) => ({
        id: delivery.id,
        runId: delivery.runId,
        taskId: run.taskId,
        taskName,
        runStatus: run.status,
        kind: 'run-completed' as const,
        payloadVersion: 1 as const,
        summary: delivery.summary,
        resultRef: `scheduler-run:${run.id}`,
        createdAt: delivery.createdAt,
        availableAt: delivery.availableAt,
        attempts: delivery.attempts,
      }));
  }

  /**
   * Return delivered state on replay and never replace the original evidence entry.
   */
  ack(
    originSessionRef: string,
    deliveryId: string,
    originEntryId: string,
    now: string
  ): SchedulerDeliveryReceipt {
    return this.database.sqlite
      .transaction(() => {
        const row = this.get(originSessionRef, deliveryId);
        if (row.status === 'delivered') {
          return this.receipt(row);
        }
        if (row.status !== 'pending') {
          throw new SchedulerTaskError('SCHEDULE_DELIVERY_CONFLICT', 'Delivery cannot be acknowledged');
        }
        const next = this.database.db
          .update(resultDeliveries)
          .set({ status: 'delivered', deliveredAt: now, originEntryId, lastErrorCode: null })
          .where(
            and(
              eq(resultDeliveries.id, deliveryId),
              eq(resultDeliveries.originSessionRef, originSessionRef),
              eq(resultDeliveries.status, 'pending')
            )
          )
          .returning()
          .get();
        return this.receipt(next);
      })
      .immediate();
  }

  /**
   * Delay a pending item; terminal records replay without reopening delivery.
   */
  defer(
    originSessionRef: string,
    deliveryId: string,
    availableAt: string,
    errorCode: string
  ): SchedulerDeliveryReceipt {
    const row = this.get(originSessionRef, deliveryId);
    if (row.status !== 'pending') {
      return this.receipt(row);
    }
    const next = this.database.db
      .update(resultDeliveries)
      .set({
        availableAt,
        attempts: sql`${resultDeliveries.attempts} + 1`,
        lastErrorCode: errorCode,
      })
      .where(
        and(
          eq(resultDeliveries.id, deliveryId),
          eq(resultDeliveries.originSessionRef, originSessionRef),
          eq(resultDeliveries.status, 'pending')
        )
      )
      .returning()
      .get();
    return this.receipt(next);
  }

  /**
   * Resolve within the bound source Session without revealing cross-session existence.
   */
  private get(originSessionRef: string, deliveryId: string) {
    const row = this.database.db
      .select()
      .from(resultDeliveries)
      .where(
        and(eq(resultDeliveries.id, deliveryId), eq(resultDeliveries.originSessionRef, originSessionRef))
      )
      .get();
    if (!row) {
      throw new SchedulerTaskError('SCHEDULE_DELIVERY_NOT_FOUND', 'Scheduler delivery not found');
    }
    return row;
  }

  /**
   * Project only acknowledgement evidence required by the source coordinator.
   */
  private receipt(row: typeof resultDeliveries.$inferSelect): SchedulerDeliveryReceipt {
    return { id: row.id, status: row.status, originEntryId: row.originEntryId };
  }
}
