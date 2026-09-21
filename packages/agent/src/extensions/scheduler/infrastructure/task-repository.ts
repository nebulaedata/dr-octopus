/**
 * @author Codex
 * @description SQLite unit of work for scoped tasks, immutable queued snapshots and durable mutation replay.
 */
import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, isNotNull, inArray, or, sql, getTableColumns } from 'drizzle-orm';
import { SchedulerTaskError } from '../definitions/task-error.js';
import { mutations, resultDeliveries, runs, tasks } from './schema.js';
import { purgeRunArtifacts } from './purge-artifacts.js';
import type {
  ScheduledPagination,
  ScheduledTaskQuery,
  ScheduledHistoryQuery,
  ScheduledHistoryRun,
} from '@octopus/shared/protocol/scheduled-tasks';
import type { SchedulerTaskRepository } from '../definitions/task-repository.js';
import type {
  SchedulerRun,
  SchedulerTaskMutation,
  SchedulerTaskRecord,
  SchedulerTaskScope,
} from '../definitions/tasks.js';
import type { SchedulerDatabase } from './database.js';

/**
 * Remove execution paths, prompts and ownership evidence from public run results.
 */
function projectRun(row: typeof runs.$inferSelect): SchedulerRun {
  return {
    id: row.id,
    taskId: row.taskId,
    status: row.status,
    scheduledFor: row.scheduledFor,
    triggerSource: row.triggerSource,
    cancelRequestedAt: row.cancelRequestedAt,
    startedAt: row.startedAt,
    settledAt: row.settledAt,
    summary: row.summary,
    errorCode: row.errorCode,
    createdAt: row.createdAt,
  };
}

/**
 * Keep all scoped SQL and transaction ownership behind one domain persistence port.
 */
export class SqliteSchedulerTaskRepository implements SchedulerTaskRepository {
  /**
   * Use the daemon's existing connection; this repository never opens or closes the database.
   */
  constructor(private readonly database: SchedulerDatabase) {}

  /**
   * CAS-bind a reviewed grant and fence queued or active work that retained the previous authority.
   */
  bindAuthorization(scope: SchedulerTaskScope, task: SchedulerTaskRecord, revision: number): void {
    this.database.sqlite
      .transaction(() => {
        this.update(scope, task, revision);
        this.skipQueued(task.id, task.updatedAt);
        this.database.db
          .update(runs)
          .set({ cancelRequestedAt: task.updatedAt })
          .where(
            and(
              eq(runs.taskId, task.id),
              inArray(runs.status, ['claimed', 'dispatching', 'running']),
              isNull(runs.cancelRequestedAt)
            )
          )
          .run();
      })
      .immediate();
  }

  /**
   * Return grant bindings for the single daemon maintenance pass.
   */
  authorizationTasks(): SchedulerTaskRecord[] {
    return this.database.db.select().from(tasks).where(isNotNull(tasks.authorizationRef)).all();
  }

  /**
   * Keep projection and cancellation atomic; retries do not increment the task revision repeatedly.
   */
  blockAuthorization(taskId: string, code: string, now: string): void {
    this.database.sqlite
      .transaction(() => {
        const task = this.database.db.select().from(tasks).where(eq(tasks.id, taskId)).get();
        if (!task) {
          return;
        }
        if (task.authorizationBlock !== code) {
          this.database.db
            .update(tasks)
            .set({ authorizationBlock: code, revision: task.revision + 1, updatedAt: now })
            .where(eq(tasks.id, taskId))
            .run();
        }
        this.skipQueued(taskId, now);
        this.database.db
          .update(runs)
          .set({ cancelRequestedAt: now })
          .where(
            and(
              eq(runs.taskId, taskId),
              inArray(runs.status, ['claimed', 'dispatching', 'running']),
              isNull(runs.cancelRequestedAt)
            )
          )
          .run();
      })
      .immediate();
  }

  /**
   * Distinguish a workspace-wide scope from an explicit history-only/null origin scope.
   */
  private fence(scope: SchedulerTaskScope) {
    return and(
      eq(tasks.workspaceId, scope.workspaceId),
      scope.originSessionRef === undefined
        ? undefined
        : scope.originSessionRef === null
          ? isNull(tasks.originSessionRef)
          : eq(tasks.originSessionRef, scope.originSessionRef)
    );
  }

  /**
   * List live tasks in deterministic update order inside the caller fence.
   */
  list(scope: SchedulerTaskScope, page: ScheduledTaskQuery): SchedulerTaskRecord[] {
    // Keep the outer table qualified: Drizzle strips column qualifiers in single-table projections.
    const active =
      sql<boolean>`exists (select 1 from scheduler_runs r where r.task_id = scheduler_tasks.id and r.status in ('queued', 'claimed', 'dispatching', 'running'))`.mapWith(
        Boolean
      );
    const attention = or(isNotNull(tasks.authorizationBlock), isNull(tasks.authorizationRef));
    const authorized = and(isNull(tasks.authorizationBlock), isNotNull(tasks.authorizationRef));
    const state =
      page.status === 'attention'
        ? attention
        : page.status === 'paused'
          ? and(authorized, isNotNull(tasks.pausedAt))
          : page.status === 'completed'
            ? and(authorized, isNull(tasks.pausedAt), eq(tasks.enabled, false), sql`not ${active}`)
            : page.status === 'pending'
              ? and(authorized, isNull(tasks.pausedAt), or(eq(tasks.enabled, true), active))
              : undefined;
    return this.database.db
      .select({ ...getTableColumns(tasks), hasActiveRun: active })
      .from(tasks)
      .where(
        and(
          this.fence(scope),
          page.status === 'archived' ? isNotNull(tasks.deletedAt) : isNull(tasks.deletedAt),
          state,
          page.q ? sql`instr(lower(${tasks.name}), lower(${page.q})) > 0` : undefined
        )
      )
      .orderBy(desc(tasks.updatedAt), desc(tasks.id))
      .limit(page.limit)
      .offset(page.offset)
      .all();
  }

  /**
   * Apply scope, literal-name search and date/status filters before stable database pagination.
   */
  searchHistory(
    scope: SchedulerTaskScope,
    page: ScheduledHistoryQuery,
    taskId?: string
  ): ScheduledHistoryRun[] {
    return this.database.db
      .select({ run: runs, taskName: tasks.name, deletedAt: tasks.deletedAt })
      .from(runs)
      .innerJoin(tasks, eq(runs.taskId, tasks.id))
      .where(
        and(
          this.fence(scope),
          taskId ? eq(tasks.id, taskId) : undefined,
          page.status ? eq(runs.status, page.status) : undefined,
          page.q ? sql`instr(lower(${tasks.name}), lower(${page.q})) > 0` : undefined,
          page.from ? sql`julianday(${runs.scheduledFor}) >= julianday(${page.from})` : undefined,
          page.to ? sql`julianday(${runs.scheduledFor}) <= julianday(${page.to})` : undefined
        )
      )
      .orderBy(desc(sql`julianday(${runs.scheduledFor})`), desc(runs.id))
      .limit(page.limit)
      .offset(page.offset)
      .all()
      .map(({ run, taskName, deletedAt }) => ({
        ...projectRun(run),
        taskName,
        archived: Boolean(deletedAt),
      }));
  }

  /**
   * Resolve without revealing whether an inaccessible task exists.
   */
  get(scope: SchedulerTaskScope, id: string, includeDeleted = false): SchedulerTaskRecord {
    const row = this.database.db
      .select()
      .from(tasks)
      .where(and(this.fence(scope), eq(tasks.id, id), includeDeleted ? undefined : isNull(tasks.deletedAt)))
      .get();
    if (!row) {
      throw new SchedulerTaskError('SCHEDULE_TASK_NOT_FOUND', 'Scheduled task not found');
    }
    return row;
  }

  /**
   * Insert a domain-validated record in the mutation transaction.
   */
  insert(task: SchedulerTaskRecord): void {
    this.database.db.insert(tasks).values(task).run();
  }

  /**
   * Enforce revision and scope even when a future caller bypasses an earlier read.
   */
  update(scope: SchedulerTaskScope, task: SchedulerTaskRecord, revision: number): void {
    const result = this.database.db
      .update(tasks)
      .set(task)
      .where(
        and(this.fence(scope), eq(tasks.id, task.id), eq(tasks.revision, revision), isNull(tasks.deletedAt))
      )
      .run();
    if (result.changes !== 1) {
      throw new SchedulerTaskError('SCHEDULE_TASK_CONFLICT', 'Task revision has changed');
    }
  }

  /**
   * Restore an archived row under the same scope and revision fence as ordinary edits.
   */
  restore(scope: SchedulerTaskScope, task: SchedulerTaskRecord, revision: number): void {
    const result = this.database.db
      .update(tasks)
      .set(task)
      .where(
        and(
          this.fence(scope),
          eq(tasks.id, task.id),
          eq(tasks.revision, revision),
          isNotNull(tasks.deletedAt)
        )
      )
      .run();
    if (result.changes !== 1) {
      throw new SchedulerTaskError('SCHEDULE_TASK_CONFLICT', 'Archived task revision has changed');
    }
  }

  /**
   * Keep running attempts and queued work intact until their final settlement.
   */
  requireInactive(taskId: string): void {
    const active = this.database.db
      .select({ id: runs.id })
      .from(runs)
      .where(
        and(eq(runs.taskId, taskId), inArray(runs.status, ['queued', 'claimed', 'dispatching', 'running']))
      )
      .get();
    if (active) {
      throw new SchedulerTaskError(
        'SCHEDULE_TASK_CONFLICT',
        'Wait for active runs to finish before restoring or deleting'
      );
    }
  }

  /**
   * Remove owned artifacts before deleting their catalog; retain only redacted replay receipts.
   */
  purge(scope: SchedulerTaskScope, task: SchedulerTaskRecord, response: SchedulerTaskMutation): void {
    const current = this.get(scope, task.id, true);
    if (!current.deletedAt || current.revision !== task.revision) {
      throw new SchedulerTaskError('SCHEDULE_TASK_CONFLICT', 'Archived task revision has changed');
    }
    this.requireInactive(task.id);
    const ownedRuns = this.database.db.select({ id: runs.id }).from(runs).where(eq(runs.taskId, task.id));
    purgeRunArtifacts(
      this.database.sqlite.name,
      ownedRuns.all().map((run) => run.id)
    );
    this.database.db.delete(resultDeliveries).where(inArray(resultDeliveries.runId, ownedRuns)).run();
    this.database.db.delete(runs).where(eq(runs.taskId, task.id)).run();
    this.database.db
      .update(mutations)
      .set({ responseJson: JSON.stringify(response) })
      .where(sql`json_extract(${mutations.responseJson}, '$.task.id') = ${task.id}`)
      .run();
    this.database.db
      .delete(tasks)
      .where(
        and(
          this.fence(scope),
          eq(tasks.id, task.id),
          eq(tasks.revision, task.revision),
          isNotNull(tasks.deletedAt)
        )
      )
      .run();
  }

  /**
   * Replay before checking current resource state and commit the exact response with its effects.
   */
  mutate(
    scope: SchedulerTaskScope,
    key: string,
    fingerprint: string,
    now: string,
    apply: () => SchedulerTaskMutation
  ): SchedulerTaskMutation {
    const scopeKey = JSON.stringify([
      scope.workspaceId,
      scope.originSessionRef === undefined,
      scope.originSessionRef ?? null,
    ]);
    try {
      return this.database.sqlite
        .transaction(() => {
          const existing = this.database.db
            .select()
            .from(mutations)
            .where(and(eq(mutations.scope, scopeKey), eq(mutations.key, key)))
            .get();
          if (existing) {
            if (existing.fingerprint !== fingerprint) {
              throw new SchedulerTaskError(
                'SCHEDULE_TASK_CONFLICT',
                'Idempotency key belongs to another request'
              );
            }
            return JSON.parse(existing.responseJson) as SchedulerTaskMutation;
          }
          const response = apply();
          this.database.db
            .insert(mutations)
            .values({
              scope: scopeKey,
              key,
              fingerprint,
              responseJson: JSON.stringify(response),
              createdAt: now,
            })
            .run();
          return response;
        })
        .immediate();
    } catch (cause) {
      if (cause instanceof SchedulerTaskError) {
        throw cause;
      }
      throw new SchedulerTaskError(
        'SCHEDULE_STORAGE_UNAVAILABLE',
        'Scheduler mutation could not be committed',
        { cause }
      );
    }
  }

  /**
   * Return bounded history only after the service authorized the parent task, including tombstones.
   */
  history(taskId: string, page: ScheduledPagination): SchedulerRun[] {
    return this.database.db
      .select()
      .from(runs)
      .where(eq(runs.taskId, taskId))
      .orderBy(desc(runs.createdAt), desc(runs.id))
      .limit(page.limit)
      .offset(page.offset)
      .all()
      .map(projectRun);
  }

  /**
   * Freeze execution inputs; task edits cannot mutate already queued work.
   */
  enqueue(task: SchedulerTaskRecord, occurrenceKey: string, now: string): SchedulerRun {
    const pending = this.database.db
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.taskId, task.id), eq(runs.status, 'queued')))
      .get();
    if (pending) {
      throw new SchedulerTaskError('SCHEDULE_TASK_CONFLICT', 'Task already has a queued run');
    }
    const row = this.database.db
      .insert(runs)
      .values({
        id: randomUUID(),
        taskId: task.id,
        occurrenceKey,
        status: 'queued',
        scheduledFor: now,
        availableAt: now,
        triggerSource: 'manual',
        workspaceId: task.workspaceId,
        cwd: task.cwd,
        originSessionRef: task.originSessionRef,
        prompt: task.prompt,
        configRevision: task.configRevision,
        authorizationRef: task.authorizationRef,
        timeoutMs: task.timeoutMs,
        createdAt: now,
      })
      .returning()
      .get();
    return projectRun(row);
  }

  /**
   * Cancel pre-dispatch work atomically with its notification, or record intent for the active owner.
   */
  cancel(taskId: string, runId: string, now: string): SchedulerRun {
    const where = and(eq(runs.taskId, taskId), eq(runs.id, runId));
    const row = this.database.db.select().from(runs).where(where).get();
    if (!row) {
      throw new SchedulerTaskError('SCHEDULE_RUN_NOT_FOUND', 'Scheduled run not found');
    }
    if (!['queued', 'claimed', 'dispatching', 'running'].includes(row.status)) {
      throw new SchedulerTaskError('SCHEDULE_RUN_NOT_CANCELLABLE', 'Run has already settled');
    }
    const next = this.database.db
      .update(runs)
      .set({
        cancelRequestedAt: row.cancelRequestedAt ?? now,
        ...(row.status === 'queued'
          ? {
              status: 'cancelled' as const,
              settledAt: now,
              summary: 'Scheduled run cancelled before execution.',
            }
          : {}),
      })
      .where(where)
      .returning()
      .get();
    if (row.status === 'queued' && row.originSessionRef !== null) {
      this.database.db
        .insert(resultDeliveries)
        .values({
          id: randomUUID(),
          runId,
          originSessionRef: row.originSessionRef,
          summary: next.summary!,
          availableAt: now,
          createdAt: now,
        })
        .run();
    }
    return projectRun(next);
  }

  /**
   * Pause/delete suppresses only queued work; retain active attempts and existing delivery records.
   */
  skipQueued(taskId: string, now: string): void {
    this.database.db
      .update(runs)
      .set({ status: 'skipped', settledAt: now, errorCode: 'SCHEDULE_TASK_INACTIVE' })
      .where(and(eq(runs.taskId, taskId), eq(runs.status, 'queued')))
      .run();
  }
}
