/**
 * @author Codex
 * @description Atomically materializes bounded due schedules into immutable Agent-owned Run snapshots.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull, lte } from 'drizzle-orm';
import { planDue } from '../services/schedule-planner.js';
import { runs, tasks } from './schema.js';
import type { SchedulerDatabase } from './database.js';

/**
 * Advance at most one hundred due task plans under the SQLite writer lock.
 */
export function materializeSchedulerWork(database: SchedulerDatabase, now: string): void {
  database.sqlite
    .transaction(() => {
      const dueTasks = database.db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.enabled, true),
            lte(tasks.nextRunAt, now),
            isNull(tasks.deletedAt),
            isNull(tasks.authorizationBlock)
          )
        )
        .orderBy(asc(tasks.nextRunAt), asc(tasks.id))
        .limit(100)
        .all();
      for (const task of dueTasks) {
        const due = task.nextRunAt!;
        let plan: ReturnType<typeof planDue>;
        try {
          plan = planDue(task.schedule, due, now, task.misfirePolicy);
        } catch {
          database.db
            .update(tasks)
            .set({ enabled: false, nextRunAt: null, updatedAt: now })
            .where(eq(tasks.id, task.id))
            .run();
          continue;
        }
        const queued = database.db
          .select({ id: runs.id })
          .from(runs)
          .where(and(eq(runs.taskId, task.id), eq(runs.status, 'queued')))
          .get();
        const status = !plan.scheduledFor || queued ? 'skipped' : 'queued';
        database.db
          .insert(runs)
          .values({
            id: randomUUID(),
            taskId: task.id,
            occurrenceKey: `scheduled:${due}`,
            status,
            scheduledFor: due,
            availableAt: now,
            triggerSource: 'schedule',
            workspaceId: task.workspaceId,
            cwd: task.cwd,
            originSessionRef: task.originSessionRef,
            prompt: task.prompt,
            configRevision: task.configRevision,
            authorizationRef: task.authorizationRef,
            timeoutMs: task.timeoutMs,
            settledAt: status === 'skipped' ? now : null,
            errorCode: !plan.scheduledFor
              ? 'SCHEDULE_MISFIRE_SKIPPED'
              : queued
                ? 'SCHEDULE_RUN_COALESCED'
                : null,
            createdAt: now,
          })
          .onConflictDoNothing()
          .run();
        database.db
          .update(tasks)
          .set({
            nextRunAt: plan.nextRunAt,
            enabled: plan.nextRunAt !== null,
            updatedAt: now,
          })
          .where(eq(tasks.id, task.id))
          .run();
      }
    })
    .immediate();
}
