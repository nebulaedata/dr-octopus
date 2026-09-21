/**
 * @author Codex
 * @description Coordinates explicit user approval and scheduler binding through separate public persistence ports.
 */
import { AuthorizationPreviews } from './authorization-previews.js';
import { taskAuthorizationApprovalSchema } from '@octopus/shared/protocol/scheduled-tasks';
import { requirePermissionGrant, PermissionGrantError } from '../../permission-system/sdk/index.js';
import { SchedulerTaskError } from '../definitions/task-error.js';
import { executionDigest } from '../services/execution-digest.js';
import { nextScheduleAt } from '../services/schedule-planner.js';
import type { GrantRepository } from '../../permission-system/sdk/index.js';
import type { SchedulerTaskRepository } from '../definitions/task-repository.js';
import type { SchedulerTaskRecord, SchedulerTaskScope } from '../definitions/tasks.js';
import type {
  TaskToolCapability,
  TaskToolCatalogEntry,
  TaskAuthorizationPreview,
} from '@octopus/shared/protocol/scheduled-tasks';

/**
 * Keep grants authoritative while reusing only the short-lived catalog explicitly requested by the user.
 */
export class SchedulerAuthorizationCoordinator {
  private readonly catalogs: AuthorizationPreviews;
  /**
   * Bind permission and scheduler ports in the Agent composition root, without shared table ownership.
   */
  constructor(
    private readonly tasks: SchedulerTaskRepository,
    private readonly grants: GrantRepository,
    private readonly profileId: string,
    inspect: (task: SchedulerTaskRecord) => Promise<TaskToolCatalogEntry[]>,
    configurationRevision: (task: SchedulerTaskRecord) => Promise<string> = () => Promise.resolve(''),
    now: () => number = Date.now
  ) {
    this.catalogs = new AuthorizationPreviews(inspect, configurationRevision, now);
  }

  /**
   * Produce exact user-reviewable capability identities from the current workspace runtime.
   */
  async preview(scope: SchedulerTaskScope, id: string): Promise<TaskAuthorizationPreview> {
    const task = this.tasks.get(scope, id);
    const tools = await this.catalogs.request(task);
    if (this.tasks.get(scope, id).revision !== task.revision) {
      throw new SchedulerTaskError('SCHEDULE_TASK_CONFLICT', 'Task changed during permission inspection');
    }
    return {
      taskRevision: task.revision,
      executionDigest: executionDigest(task),
      cwd: task.cwd,
      tools,
      authorizedToolIdentities: this.authorizedToolIdentities(task),
      warnings: [
        'Selected tools receive their full tool capability within the existing permission gate. Shell approval is not limited to date.',
        'Authorization persists until revoked or execution content changes. Approval does not replay old runs.',
      ],
    };
  }

  /**
   * Read only valid persisted authority; invalid grants leave the review unselected.
   */
  private authorizedToolIdentities(task: SchedulerTaskRecord): string[] {
    if (task.deletedAt || task.authorizationBlock) {
      return [];
    }
    try {
      return requirePermissionGrant(
        this.grants,
        {
          profileId: this.profileId,
          subjectId: task.id,
          workspaceId: task.workspaceId,
          executionDigest: executionDigest(task),
        },
        task.authorizationRef
      ).tools.map((tool) => tool.identity);
    } catch (error) {
      if (!(error instanceof PermissionGrantError)) {
        throw error;
      }
      return [];
    }
  }

  /**
   * Recognize a completed exact operation after response loss or concurrent confirmation.
   */
  private approvalApplied(
    task: SchedulerTaskRecord,
    revision: number,
    operationId: string,
    tools: TaskToolCapability[]
  ): boolean {
    if (!task.authorizationRef || task.revision !== revision + 1) {
      return false;
    }
    const prior = this.grants.get(task.authorizationRef.grantId);
    return (
      prior?.operationId === operationId &&
      prior.state === 'active' &&
      JSON.stringify(prior.tools) === JSON.stringify(tools)
    );
  }

  /**
   * Commit the user-selected scope, then CAS-bind the task; replay of an incomplete operation is safe.
   */
  async approve(
    scope: SchedulerTaskScope,
    id: string,
    revision: number,
    key: string,
    input: unknown
  ): Promise<void> {
    const parsed = taskAuthorizationApprovalSchema.safeParse(input);
    if (!parsed.success || !/^[\x21-\x7e]{1,200}$/.test(key)) {
      throw new SchedulerTaskError('SCHEDULE_INVALID', 'Invalid explicit authorization');
    }
    const task = this.tasks.get(scope, id);
    const data = parsed.data;
    if (data.executionDigest !== executionDigest(task)) {
      throw new SchedulerTaskError('SCHEDULE_TASK_CONFLICT', 'Task content changed; review it again');
    }
    const tools = [...data.tools].sort((a, b) => a.name.localeCompare(b.name));
    if (new Set(tools.map((tool) => tool.name)).size !== tools.length) {
      throw new SchedulerTaskError('SCHEDULE_INVALID', 'Duplicate tool permission');
    }
    const operationId = JSON.stringify([this.profileId, id, key]);
    if (this.approvalApplied(task, revision, operationId, tools)) {
      return;
    }
    if (task.revision !== revision) {
      throw new SchedulerTaskError('SCHEDULE_TASK_CONFLICT', 'Task revision changed');
    }
    const reviewed = await this.catalogs.reviewed(task);
    if (
      tools.some(
        (tool) =>
          !reviewed.some(
            (actual) =>
              !actual.unavailableReason &&
              actual.name === tool.name &&
              actual.identity === tool.identity &&
              actual.description === tool.description
          )
      )
    ) {
      throw new SchedulerTaskError('SCHEDULE_TASK_CONFLICT', 'Tool definitions changed; review them again');
    }
    const current = this.tasks.get(scope, id);
    if (this.approvalApplied(current, revision, operationId, tools)) {
      return;
    }
    if (current.revision !== revision) {
      throw new SchedulerTaskError('SCHEDULE_TASK_CONFLICT', 'Task revision changed; review it again');
    }
    const grant = this.grants.approve(
      {
        profileId: this.profileId,
        subjectId: id,
        workspaceId: task.workspaceId,
        executionDigest: data.executionDigest,
      },
      tools,
      operationId
    );
    if (grant.state !== 'active') {
      throw new SchedulerTaskError(
        'SCHEDULE_TASK_CONFLICT',
        'This authorization operation was revoked; review again'
      );
    }
    const now = new Date().toISOString();
    try {
      this.tasks.bindAuthorization(
        scope,
        {
          ...task,
          authorizationRef: {
            grantId: grant.id,
            grantRevision: grant.revision,
            executionDigest: data.executionDigest,
          },
          authorizationBlock: null,
          revision: revision + 1,
          nextRunAt: task.enabled ? nextScheduleAt(task.schedule, now) : null,
          updatedAt: now,
        },
        revision
      );
    } catch (error) {
      if (error instanceof SchedulerTaskError && error.code.includes('CONFLICT')) {
        this.grants.revoke(grant.id, grant.revision);
      }
      throw error;
    }
    if (task.authorizationRef && task.authorizationRef.grantId !== grant.id) {
      this.grants.revoke(task.authorizationRef.grantId, task.authorizationRef.grantRevision);
    }
  }

  /**
   * Revoke before changing the scheduler projection; a failed projection cannot restore authority.
   */
  revoke(scope: SchedulerTaskScope, id: string, revision: number): void {
    const task = this.tasks.get(scope, id);
    if (task.authorizationBlock === 'SCHEDULE_AUTHORIZATION_REVOKED' && task.revision === revision + 1) {
      return;
    }
    if (task.revision !== revision) {
      throw new SchedulerTaskError('SCHEDULE_TASK_CONFLICT', 'Task revision changed');
    }
    if (task.authorizationRef) {
      this.grants.revoke(task.authorizationRef.grantId, task.authorizationRef.grantRevision);
    }
    this.tasks.blockAuthorization(task.id, 'SCHEDULE_AUTHORIZATION_REVOKED', new Date().toISOString());
  }

  /**
   * Reconcile current grants before admission, including deleted tasks and stale projections after crashes.
   */
  reconcile(): void {
    for (const task of this.tasks.authorizationTasks()) {
      try {
        if (task.deletedAt || task.authorizationBlock === 'SCHEDULE_AUTHORIZATION_STALE') {
          if (task.authorizationRef) {
            this.grants.revoke(task.authorizationRef.grantId, task.authorizationRef.grantRevision);
          }
          this.tasks.blockAuthorization(task.id, 'SCHEDULE_AUTHORIZATION_STALE', new Date().toISOString());
          continue;
        }
        requirePermissionGrant(
          this.grants,
          {
            profileId: this.profileId,
            subjectId: task.id,
            workspaceId: task.workspaceId,
            executionDigest: executionDigest(task),
          },
          task.authorizationRef
        );
      } catch (error) {
        if (!(error instanceof PermissionGrantError)) {
          throw error;
        }
        this.tasks.blockAuthorization(task.id, error.code, new Date().toISOString());
      }
    }
  }
}
