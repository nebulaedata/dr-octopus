/**
 * @author Codex
 * @description Singleton-daemon work claims, dispatch barriers, recovery and terminal delivery transactions.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, lte, not, or, sql } from 'drizzle-orm';
import { materializeSchedulerWork } from './materialization.js';
import { resultDeliveries, runs, tasks } from './schema.js';
import type { SchedulerDatabase } from './database.js';
import type {
  SchedulerExecutionWork,
  SchedulerRunOutcome,
  SchedulerSessionEvidence,
  SchedulerWorkDiagnostics,
} from '../definitions/work.js';

const activeStatuses = ['claimed', 'dispatching', 'running'] as const;

/**
 * Convert persisted snapshots into the narrow runner contract.
 */
function work(
  run: typeof runs.$inferSelect,
  overlapPolicy: 'skip' | 'queue-one',
  timezone: string
): SchedulerExecutionWork {
  return {
    runId: run.id,
    taskId: run.taskId,
    attemptId: run.attemptId!,
    workspaceId: run.workspaceId,
    cwd: run.cwd,
    originSessionRef: run.originSessionRef,
    prompt: run.prompt,
    configRevision: run.configRevision,
    authorizationRef: run.authorizationRef,
    timeoutMs: run.timeoutMs,
    scheduledFor: run.scheduledFor,
    overlapPolicy,
    timezone,
  };
}

/**
 * Own short synchronous state transitions; no Pi or network work occurs inside transactions.
 */
export class SchedulerWorkRepository {
  /**
   * Reuse the daemon-owned connection and lifecycle lock.
   */
  constructor(private readonly database: SchedulerDatabase) {}

  /**
   * Materialize due plans without scheduling one process timer per task.
   */
  materialize(now: string): void {
    materializeSchedulerWork(this.database, now);
  }

  /**
   * Claim one runnable snapshot under the supplied global limit (default 3), Workspace and Task limits.
   */
  claim(daemonId: string, now: string, maxConcurrentRuns = 3): SchedulerExecutionWork | undefined {
    return this.database.sqlite
      .transaction(() => {
        const active = this.database.db
          .select({ taskId: runs.taskId, workspaceId: runs.workspaceId })
          .from(runs)
          .where(inArray(runs.status, activeStatuses))
          .all();
        if (active.length >= maxConcurrentRuns) {
          return undefined;
        }
        const candidates = this.database.db
          .select({ run: runs, task: tasks })
          .from(runs)
          .innerJoin(tasks, eq(tasks.id, runs.taskId))
          .where(and(eq(runs.status, 'queued'), lte(runs.availableAt, now)))
          .orderBy(asc(runs.availableAt), asc(runs.id))
          .limit(100)
          .all();
        for (const candidate of candidates) {
          if (candidate.task.pausedAt || candidate.task.deletedAt || candidate.task.authorizationBlock) {
            this.skip(candidate.run.id, now, 'SCHEDULE_TASK_INACTIVE');
            continue;
          }
          const taskActive = active.some((item) => item.taskId === candidate.run.taskId);
          if (taskActive) {
            if (candidate.task.overlapPolicy === 'skip') {
              this.skip(candidate.run.id, now, 'SCHEDULE_RUNTIME_BUSY');
            }
            continue;
          }
          if (active.filter((item) => item.workspaceId === candidate.run.workspaceId).length >= 2) {
            continue;
          }
          const attemptId = randomUUID();
          const claimed = this.database.db
            .update(runs)
            .set({ status: 'claimed', daemonId, attemptId })
            .where(and(eq(runs.id, candidate.run.id), eq(runs.status, 'queued')))
            .returning()
            .get();
          if (claimed) {
            return work(
              claimed,
              candidate.task.overlapPolicy,
              candidate.task.schedule.type === 'cron' ? candidate.task.schedule.timezone : 'UTC'
            );
          }
        }
        return undefined;
      })
      .immediate();
  }

  /**
   * Commit isolated Session identity before the first prompt can become externally visible.
   */
  dispatch(
    claimed: SchedulerExecutionWork,
    daemonId: string,
    now: string,
    evidence: SchedulerSessionEvidence
  ): boolean {
    return this.database.sqlite
      .transaction(() => {
        const task = this.database.db
          .select({
            pausedAt: tasks.pausedAt,
            deletedAt: tasks.deletedAt,
            authorizationBlock: tasks.authorizationBlock,
          })
          .from(tasks)
          .where(eq(tasks.id, claimed.taskId))
          .get();
        if (!task || task.pausedAt || task.deletedAt || task.authorizationBlock) {
          return false;
        }
        return (
          this.database.db
            .update(runs)
            .set({
              status: 'dispatching',
              sessionId: evidence.sessionId,
              sessionPath: evidence.sessionPath,
              dispatchAt: now,
            })
            .where(
              and(
                eq(runs.id, claimed.runId),
                eq(runs.status, 'claimed'),
                eq(runs.daemonId, daemonId),
                eq(runs.attemptId, claimed.attemptId),
                isNull(runs.cancelRequestedAt)
              )
            )
            .run().changes === 1
        );
      })
      .immediate();
  }

  /**
   * Record durable prompt evidence without resurrecting a settled Run.
   */
  running(claimed: SchedulerExecutionWork, daemonId: string, promptEntryId: string, now: string): boolean {
    return (
      this.database.db
        .update(runs)
        .set({ status: 'running', promptEntryId, startedAt: now })
        .where(
          and(
            eq(runs.id, claimed.runId),
            eq(runs.status, 'dispatching'),
            eq(runs.daemonId, daemonId),
            eq(runs.attemptId, claimed.attemptId)
          )
        )
        .run().changes === 1
    );
  }

  /**
   * Read cancellation intent for the exact claimed attempt.
   */
  cancellationRequested(claimed: SchedulerExecutionWork, daemonId: string): boolean {
    return !!this.database.db
      .select({ at: runs.cancelRequestedAt })
      .from(runs)
      .where(
        and(eq(runs.id, claimed.runId), eq(runs.daemonId, daemonId), eq(runs.attemptId, claimed.attemptId))
      )
      .get()?.at;
  }

  /**
   * Settle a claim that lost task eligibility before its dispatch barrier, without a completion delivery.
   */
  abandonClaim(
    claimed: SchedulerExecutionWork,
    daemonId: string,
    now: string,
    errorCode = 'SCHEDULE_TASK_INACTIVE'
  ): boolean {
    return (
      this.database.db
        .update(runs)
        .set({ status: 'skipped', settledAt: now, errorCode })
        .where(
          and(
            eq(runs.id, claimed.runId),
            eq(runs.status, 'claimed'),
            eq(runs.daemonId, daemonId),
            eq(runs.attemptId, claimed.attemptId)
          )
        )
        .run().changes === 1
    );
  }

  /**
   * Commit a terminal outcome and one pending completion delivery as one idempotent transaction.
   */
  finish(
    claimed: SchedulerExecutionWork,
    daemonId: string,
    now: string,
    outcome: SchedulerRunOutcome
  ): boolean {
    return this.database.sqlite
      .transaction(() => {
        const summary = outcome.summary.slice(0, 4000);
        const changed = this.database.db
          .update(runs)
          .set({ status: outcome.status, settledAt: now, summary, errorCode: outcome.errorCode })
          .where(
            and(
              eq(runs.id, claimed.runId),
              inArray(runs.status, activeStatuses),
              eq(runs.daemonId, daemonId),
              eq(runs.attemptId, claimed.attemptId)
            )
          )
          .run().changes;
        if (changed !== 1) {
          return false;
        }
        if (outcome.status === 'needs_attention') {
          this.database.db
            .update(tasks)
            .set({
              authorizationBlock: outcome.errorCode,
              revision: sql`${tasks.revision} + 1`,
              updatedAt: now,
            })
            .where(
              and(
                eq(tasks.id, claimed.taskId),
                isNull(tasks.authorizationBlock),
                claimed.authorizationRef
                  ? eq(tasks.authorizationRef, claimed.authorizationRef)
                  : isNull(tasks.authorizationRef)
              )
            )
            .run();
        }
        this.enqueueDelivery(claimed.runId, claimed.originSessionRef, summary, now);
        return true;
      })
      .immediate();
  }

  /**
   * Recover all state owned by a previous daemon before admitting new claims.
   */
  recoverAbandoned(daemonId: string, now: string): void {
    this.database.sqlite
      .transaction(() => {
        const abandoned = this.database.db
          .select()
          .from(runs)
          .where(
            and(
              inArray(runs.status, activeStatuses),
              or(isNull(runs.daemonId), not(eq(runs.daemonId, daemonId)))
            )
          )
          .all();
        for (const run of abandoned) {
          if (run.status === 'claimed') {
            const queued = this.database.db
              .select({ id: runs.id })
              .from(runs)
              .where(and(eq(runs.taskId, run.taskId), eq(runs.status, 'queued')))
              .get();
            const status = run.cancelRequestedAt ? 'cancelled' : queued ? 'skipped' : 'queued';
            this.database.db
              .update(runs)
              .set({
                status,
                daemonId: null,
                attemptId: null,
                availableAt: now,
                settledAt: status === 'queued' ? null : now,
                summary: status === 'cancelled' ? 'Scheduled run cancelled before execution.' : null,
                errorCode: status === 'skipped' ? 'SCHEDULE_RUN_COALESCED' : null,
              })
              .where(and(eq(runs.id, run.id), eq(runs.status, 'claimed')))
              .run();
            if (status === 'cancelled') {
              this.enqueueDelivery(
                run.id,
                run.originSessionRef,
                'Scheduled run cancelled before execution.',
                now
              );
            }
            continue;
          }
          const summary = 'Scheduled execution was interrupted after dispatch.';
          this.database.db
            .update(runs)
            .set({
              status: 'interrupted',
              settledAt: now,
              summary,
              errorCode: 'SCHEDULE_EXECUTION_INTERRUPTED',
            })
            .where(and(eq(runs.id, run.id), inArray(runs.status, ['dispatching', 'running'])))
            .run();
          this.enqueueDelivery(run.id, run.originSessionRef, summary, now);
        }
      })
      .immediate();
  }

  /**
   * Return bounded worker diagnostics without prompts or internal paths.
   */
  diagnostics(): SchedulerWorkDiagnostics {
    return {
      queued:
        this.database.db
          .select({ count: sql<number>`count(*)` })
          .from(runs)
          .where(eq(runs.status, 'queued'))
          .get()?.count ?? 0,
      running:
        this.database.db
          .select({ count: sql<number>`count(*)` })
          .from(runs)
          .where(inArray(runs.status, activeStatuses))
          .get()?.count ?? 0,
      nextRunAt:
        this.database.db
          .select({ value: sql<string | null>`min(${tasks.nextRunAt})` })
          .from(tasks)
          .where(eq(tasks.enabled, true))
          .get()?.value ?? null,
    };
  }

  /**
   * Persist history-only skip state for an ineligible queue candidate.
   */
  private skip(runId: string, now: string, errorCode: string): void {
    this.database.db
      .update(runs)
      .set({ status: 'skipped', settledAt: now, errorCode })
      .where(and(eq(runs.id, runId), eq(runs.status, 'queued')))
      .run();
  }

  /**
   * Insert the stable completion identity; repeated settle/recovery cannot duplicate it.
   */
  private enqueueDelivery(
    runId: string,
    originSessionRef: string | null,
    summary: string,
    now: string
  ): void {
    if (!originSessionRef) {
      return;
    }
    this.database.db
      .insert(resultDeliveries)
      .values({
        id: randomUUID(),
        runId,
        originSessionRef,
        summary,
        availableAt: now,
        createdAt: now,
      })
      .onConflictDoNothing()
      .run();
  }
}
