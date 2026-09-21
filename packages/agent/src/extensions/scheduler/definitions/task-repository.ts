/**
 * @author Codex
 * @description Transactional persistence port: all mutation effects and replay responses commit together.
 */
import type {
  ScheduledPagination,
  ScheduledTaskQuery,
  ScheduledHistoryQuery,
  ScheduledHistoryRun,
} from '@octopus/shared/protocol/scheduled-tasks';
import type {
  SchedulerRun,
  SchedulerTaskMutation,
  SchedulerTaskRecord,
  SchedulerTaskScope,
} from './tasks.js';

export interface SchedulerTaskRepository {
  /**
   * List retained authorization bindings for reconciliation before admitting new work.
   */
  authorizationTasks(): SchedulerTaskRecord[];
  /**
   * Bind a new authorization and cancel all older execution snapshots in one scheduler transaction.
   */
  bindAuthorization(scope: SchedulerTaskScope, task: SchedulerTaskRecord, revision: number): void;
  /**
   * Block future admission and cancel queued/active old work atomically without changing the grant store.
   */
  blockAuthorization(taskId: string, code: string, now: string): void;
  /**
   * List only live tasks within the trusted caller scope in stable bounded order.
   */
  list(scope: SchedulerTaskScope, page: ScheduledTaskQuery): SchedulerTaskRecord[];
  /**
   * Search retained runs within the caller fence, including archived parents.
   */
  searchHistory(
    scope: SchedulerTaskScope,
    page: ScheduledHistoryQuery,
    taskId?: string
  ): ScheduledHistoryRun[];
  /**
   * Resolve a scoped task; include tombstones only when reading retained history.
   */
  get(scope: SchedulerTaskScope, id: string, includeDeleted?: boolean): SchedulerTaskRecord;
  /**
   * Insert inside the caller's transaction after domain validation.
   */
  insert(task: SchedulerTaskRecord): void;
  /**
   * Write a new revision only if the expected revision and scope still match.
   */
  update(scope: SchedulerTaskScope, task: SchedulerTaskRecord, revision: number): void;
  /**
   * Restore only an archived revision; preserve history and clear authority before resuming.
   */
  restore(scope: SchedulerTaskScope, task: SchedulerTaskRecord, revision: number): void;
  /**
   * Refuse archived lifecycle changes while any queued or active execution remains.
   */
  requireInactive(taskId: string): void;
  /**
   * Delete an archived task and its owned records/artifacts; redact prior mutation replay payloads.
   */
  purge(scope: SchedulerTaskScope, task: SchedulerTaskRecord, response: SchedulerTaskMutation): void;
  /**
   * Replay before resource checks; synchronous apply and response persistence form one transaction.
   */
  mutate(
    scope: SchedulerTaskScope,
    key: string,
    fingerprint: string,
    now: string,
    apply: () => SchedulerTaskMutation
  ): SchedulerTaskMutation;
  /**
   * List safe run projections for a task already authorized by the service.
   */
  history(taskId: string, page: ScheduledPagination): SchedulerRun[];
  /**
   * Freeze the task's execution snapshot and enforce at most one queued run per task.
   */
  enqueue(task: SchedulerTaskRecord, occurrenceKey: string, now: string): SchedulerRun;
  /**
   * Cancel queued work or persist active cancellation intent without touching any process.
   */
  cancel(taskId: string, runId: string, now: string): SchedulerRun;
  /**
   * Retain queued history as skipped on pause or deletion; active attempts are unchanged.
   */
  skipQueued(taskId: string, now: string): void;
}
