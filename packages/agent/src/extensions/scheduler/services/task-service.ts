/**
 * @author Codex
 * @description Validate and coordinate scheduler task mutations through a transactional port, without Host or Pi dependencies.
 */
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import {
  scheduledTaskInputSchema,
  scheduledTaskPatchSchema,
  scheduledTaskQuerySchema,
  scheduledHistoryQuerySchema,
  scheduledCancelSchema,
  scheduledEmptySchema,
} from '@octopus/shared/protocol/scheduled-tasks';
import { SchedulerTaskError } from '../definitions/task-error.js';
import { initialScheduleAt, normalizeSchedule } from './schedule-planner.js';
import type { SchedulerTaskRepository } from '../definitions/task-repository.js';
import type {
  SchedulerTask,
  SchedulerTaskContext,
  SchedulerTaskMutation,
  SchedulerTaskMutationRequest,
  SchedulerTaskRecord,
  SchedulerTaskScope,
  SchedulerPage,
  SchedulerRun,
} from '../definitions/tasks.js';

/**
 * Canonicalize validated JSON so equivalent property ordering produces the same replay identity.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return '[' + value.map(canonical).join(',') + ']';
  }
  if (value !== null && typeof value === 'object') {
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Explicitly project public task data without internal paths or execution configuration storage.
 */
function project(task: SchedulerTaskRecord): SchedulerTask {
  return {
    id: task.id,
    workspaceId: task.workspaceId,
    originSessionRef: task.originSessionRef,
    executionMode: 'isolated-run',
    ...(task.hasActiveRun === undefined ? {} : { hasActiveRun: task.hasActiveRun }),
    name: task.name,
    description: task.description,
    prompt: task.prompt,
    schedule: task.schedule,
    enabled: task.enabled,
    misfirePolicy: task.misfirePolicy,
    overlapPolicy: task.overlapPolicy,
    timeoutMs: task.timeoutMs,
    revision: task.revision,
    authorizationRef: task.authorizationRef,
    authorizationBlock: task.authorizationBlock,
    nextRunAt: task.nextRunAt,
    pausedAt: task.pausedAt,
    deletedAt: task.deletedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

/**
 * Own business validation and orchestration while repositories enforce atomic commit boundaries.
 */
export class SchedulerTaskService {
  private closing = false;

  /**
   * Inject the persistence boundary and clock; the daemon Worker consumes the resulting durable work separately.
   */
  constructor(
    private readonly repository: SchedulerTaskRepository,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly revokeArchivedGrant: (task: SchedulerTaskRecord) => void = (task) => {
      if (task.authorizationRef) {
        throw new SchedulerTaskError(
          'SCHEDULE_AUTHORIZATION_UNAVAILABLE',
          'Grant revocation is required for archived lifecycle changes'
        );
      }
    }
  ) {}

  /**
   * Reject newly admitted mutations before daemon shutdown begins.
   */
  stopMutations(): void {
    this.closing = true;
  }

  /**
   * Return a bounded, scoped list of live tasks.
   */
  list(scope: SchedulerTaskScope, query: unknown = {}): SchedulerPage<SchedulerTask> {
    this.validateScope(scope);
    const page = scheduledTaskQuerySchema.safeParse(query);
    if (!page.success) {
      throw this.invalid();
    }
    return this.read(() => ({ ...page.data, items: this.repository.list(scope, page.data).map(project) }));
  }

  /**
   * Resolve a live task without exposing inaccessible resources.
   */
  get(scope: SchedulerTaskScope, id: string): SchedulerTask {
    this.validateScope(scope);
    return this.read(() => project(this.repository.get(scope, id)));
  }

  /**
   * Retain access to authorized execution history after task soft deletion.
   */
  history(scope: SchedulerTaskScope, id: string, query: unknown = {}): SchedulerPage<SchedulerRun> {
    this.validateScope(scope);
    const page = scheduledHistoryQuerySchema.safeParse(query);
    if (!page.success) {
      throw this.invalid();
    }
    return this.read(() => {
      if (id) {
        this.repository.get(scope, id, true);
      }
      return { ...page.data, items: this.repository.searchHistory(scope, page.data, id || undefined) };
    });
  }

  /**
   * Normalize before fingerprinting, then commit all effects and their public response as one unit.
   */
  mutate(context: SchedulerTaskContext, request: SchedulerTaskMutationRequest): SchedulerTaskMutation {
    if (this.closing) {
      throw new SchedulerTaskError('SCHEDULE_WORKER_UNAVAILABLE', 'Scheduler is stopping');
    }
    this.validateScope(context);
    if (
      !isAbsolute(context.cwd) ||
      !context.configRevision ||
      context.configRevision.length > 200 ||
      !/^[\x21-\x7e]{1,200}$/.test(request.key) ||
      !['create', 'update', 'delete', 'restore', 'purge', 'run-now', 'cancel'].includes(request.operation) ||
      Object.keys(request).some((key) => !['operation', 'key', 'taskId', 'revision', 'input'].includes(key))
    ) {
      throw this.invalid();
    }
    if (request.operation !== 'create' && (!request.taskId || request.taskId.length > 200)) {
      throw this.invalid();
    }
    if (
      ['update', 'delete', 'restore', 'purge'].includes(request.operation) &&
      (!Number.isSafeInteger(request.revision) || request.revision! < 1)
    ) {
      throw new SchedulerTaskError('SCHEDULE_REVISION_REQUIRED', 'A positive expected revision is required');
    }
    const schema =
      request.operation === 'create'
        ? scheduledTaskInputSchema
        : request.operation === 'update'
          ? scheduledTaskPatchSchema
          : request.operation === 'cancel'
            ? scheduledCancelSchema
            : scheduledEmptySchema;
    const parsed = schema.safeParse(request.input);
    if (!parsed.success) {
      throw this.invalid();
    }
    const input =
      'schedule' in parsed.data && parsed.data.schedule
        ? { ...parsed.data, schedule: normalizeSchedule(parsed.data.schedule) }
        : parsed.data;
    const fingerprint = createHash('sha256')
      .update(
        canonical({ operation: request.operation, taskId: request.taskId, revision: request.revision, input })
      )
      .digest('hex');
    const now = this.now();
    return this.repository.mutate(context, request.key, fingerprint, now, () => {
      if (request.operation === 'create') {
        const data = scheduledTaskInputSchema.parse(input);
        const task: SchedulerTaskRecord = {
          ...data,
          id: randomUUID(),
          workspaceId: context.workspaceId,
          cwd: context.cwd,
          configRevision: context.configRevision,
          originSessionRef: context.originSessionRef ?? null,
          revision: 1,
          authorizationRef: null,
          authorizationBlock: 'SCHEDULE_AUTHORIZATION_REQUIRED',
          nextRunAt: data.enabled ? initialScheduleAt(data.schedule, now) : null,
          pausedAt: data.enabled ? null : now,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        this.repository.insert(task);
        return {
          effect: 'saved',
          task: project(task),
          warnings: ['Task saved; explicit persistent authorization is required before execution.'],
        };
      }
      const archivedAction = request.operation === 'restore' || request.operation === 'purge';
      const task = this.repository.get(context, request.taskId!, archivedAction);
      if (archivedAction) {
        if (!task.deletedAt || task.revision !== request.revision) {
          throw new SchedulerTaskError(
            'SCHEDULE_TASK_CONFLICT',
            'Only the current archived revision can be restored or deleted'
          );
        }
        this.repository.requireInactive(task.id);
        this.revokeArchivedGrant(task);
        const next = {
          ...task,
          revision: task.revision + 1,
          updatedAt: now,
          authorizationRef: null,
          authorizationBlock: 'SCHEDULE_AUTHORIZATION_REQUIRED',
          enabled: false,
          pausedAt: now,
          nextRunAt: null,
        };
        if (request.operation === 'restore') {
          next.deletedAt = null;
          this.repository.restore(context, next, task.revision);
          return { effect: 'restored', task: project(next), warnings: [] };
        }
        const response: SchedulerTaskMutation = {
          effect: 'purged',
          task: project({
            ...next,
            name: 'Deleted task',
            description: '',
            prompt: '[deleted]',
            originSessionRef: null,
            schedule: { type: 'once', at: now },
          }),
          warnings: [],
        };
        this.repository.purge(context, task, response);
        return response;
      }
      if (request.operation === 'run-now') {
        if (task.authorizationBlock || !task.authorizationRef) {
          throw new SchedulerTaskError(
            'SCHEDULE_AUTHORIZATION_REQUIRED',
            'Authorize this task before running it'
          );
        }
        if (task.pausedAt) {
          throw new SchedulerTaskError('SCHEDULE_TASK_CONFLICT', 'Resume the task before requesting a run');
        }
        const run = this.repository.enqueue(
          task,
          'manual:' +
            createHash('sha256')
              .update(
                canonical([
                  context.workspaceId,
                  context.originSessionRef === undefined,
                  context.originSessionRef ?? null,
                  request.key,
                ])
              )
              .digest('hex'),
          now
        );
        return { effect: 'queued', task: project(task), run, warnings: [] };
      }
      if (request.operation === 'cancel') {
        const run = this.repository.cancel(task.id, scheduledCancelSchema.parse(input).runId, now);
        return {
          effect: run.status === 'cancelled' ? 'cancelled' : 'cancellation_requested',
          task: project(task),
          run,
          warnings: ['Task saved; explicit persistent authorization is required before execution.'],
        };
      }
      if (task.revision !== request.revision) {
        throw new SchedulerTaskError('SCHEDULE_TASK_CONFLICT', 'Task revision has changed');
      }
      const next = { ...task, revision: task.revision + 1, updatedAt: now };
      if (request.operation === 'delete') {
        next.deletedAt = now;
        next.authorizationBlock = 'SCHEDULE_AUTHORIZATION_STALE';
        next.enabled = false;
        next.nextRunAt = null;
        this.repository.skipQueued(task.id, now);
      } else {
        const patch = scheduledTaskPatchSchema.parse(input);
        Object.assign(next, patch);
        if (
          (patch.prompt !== undefined && patch.prompt !== task.prompt) ||
          (patch.timeoutMs !== undefined && patch.timeoutMs !== task.timeoutMs)
        ) {
          next.authorizationBlock = 'SCHEDULE_AUTHORIZATION_STALE';
          this.repository.skipQueued(task.id, now);
        }
        if (patch.enabled === false) {
          next.pausedAt = now;
          this.repository.skipQueued(task.id, now);
        } else if (patch.enabled === true) {
          next.pausedAt = null;
        }
        if (patch.schedule !== undefined || patch.enabled !== undefined) {
          next.nextRunAt = next.enabled ? initialScheduleAt(next.schedule, now) : null;
        }
      }
      this.repository.update(context, next, task.revision);
      if (next.deletedAt || next.authorizationBlock === 'SCHEDULE_AUTHORIZATION_STALE') {
        this.repository.blockAuthorization(
          next.id,
          next.authorizationBlock ?? 'SCHEDULE_AUTHORIZATION_REVOKED',
          now
        );
      }
      return {
        effect: request.operation === 'delete' ? 'deleted' : 'saved',
        task: project(next),
        warnings: [],
      };
    });
  }

  /**
   * Validate trusted adapter scope as a defensive boundary; model inputs cannot supply it.
   */
  private validateScope(scope: SchedulerTaskScope): void {
    if (
      !scope.workspaceId ||
      scope.workspaceId.length > 200 ||
      (scope.originSessionRef !== undefined &&
        scope.originSessionRef !== null &&
        (scope.originSessionRef.length === 0 || scope.originSessionRef.length > 500))
    ) {
      throw this.invalid();
    }
  }

  /**
   * Translate storage failures on reads without including SQL or internal path details.
   */
  private read<T>(action: () => T): T {
    try {
      return action();
    } catch (cause) {
      if (cause instanceof SchedulerTaskError) {
        throw cause;
      }
      throw new SchedulerTaskError('SCHEDULE_STORAGE_UNAVAILABLE', 'Scheduler data is unavailable', {
        cause,
      });
    }
  }

  /**
   * Do not echo malformed prompts, identities or supplied secrets in validation failures.
   */
  private invalid(): SchedulerTaskError {
    return new SchedulerTaskError('SCHEDULE_INVALID', 'Invalid scheduled-task request');
  }
}
