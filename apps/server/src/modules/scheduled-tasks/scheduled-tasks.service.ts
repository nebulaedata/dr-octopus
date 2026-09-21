/**
 * @author Codex
 * @description Thin Server adapter over the Agent-owned Scheduler SDK and trusted Workspace/Session mapping.
 */
import {
  createSchedulerClient,
  getSchedulerServiceStatus,
  getSchedulerSettings,
  restartSchedulerService,
  startSchedulerService,
  stopSchedulerService,
  updateSchedulerSettings,
} from '@octopus/agent';
import {
  scheduledTaskQuerySchema,
  scheduledHistoryQuerySchema,
} from '@octopus/shared/protocol/scheduled-tasks';
import { ApplicationError } from '../../lib/errors/application-error.js';
import { z } from 'zod';
import { mergeTaskPage, mergeSortedPage } from './merged-task-page.js';
import type { AgentSchedulerClient } from '@octopus/agent';
import type {
  SchedulerServiceStatus,
  SchedulerSettingsUpdate,
  SchedulerTask,
  SchedulerTaskMutation,
  SchedulerResult,
} from '@octopus/agent';
import type {
  ScheduledMutation,
  ScheduledTask,
  ScheduledHistoryRun,
} from '@octopus/shared/protocol/scheduled-tasks';
import type { SessionsService } from '../sessions/sessions.service.js';
import type { WorkspacesService } from '../workspaces/workspaces.service.js';

export type SchedulerOperation =
  'update' | 'delete' | 'restore' | 'purge' | 'run-now' | 'cancel' | 'authorize' | 'revoke-authorization';
export interface SchedulerMutationRequest {
  operation: SchedulerOperation;
  key: string;
  taskId?: string;
  revision?: number;
  input: unknown;
}
export interface SchedulerScope {
  workspaceId: string;
  sessionId?: string;
}
export interface ScheduledTasksServiceOptions {
  agentDir: string;
  workspaces: WorkspacesService;
  sessions: SessionsService;
  createClient?: typeof createSchedulerClient;
  readStatus?: typeof getSchedulerServiceStatus;
  startService?: typeof startSchedulerService;
  stopService?: typeof stopSchedulerService;
  restartService?: typeof restartSchedulerService;
  readSettings?: typeof getSchedulerSettings;
  updateSettings?: typeof updateSchedulerSettings;
  /**
   * Reconcile Host result references only after Agent commits an authoritative purge.
   */
  onPurged?(workspaceId: string, taskId: string): Promise<void>;
}

/**
 * Cache only transport clients; all task state, timers and execution ownership remain in Agent.
 */
export class ScheduledTasksService {
  private readonly clients = new Map<
    string,
    { cwd: string; configRevision: string; client: AgentSchedulerClient }
  >();

  /**
   * Inject Host mapping services and the canonical Agent profile directory.
   */
  constructor(private readonly options: ScheduledTasksServiceOptions) {}

  /**
   * Merge trusted workspace catalogs into one page after applying task filters.
   */
  async catalog(query: unknown) {
    const parsed = scheduledTaskQuerySchema
      .extend({ workspaceId: z.string().min(1).max(200).optional() })
      .safeParse(query);
    if (!parsed.success) {
      throw this.invalid();
    }
    const { workspaceId, ...page } = parsed.data;
    if (workspaceId) {
      return this.list({ workspaceId }, page);
    }
    const workspaces = await this.options.workspaces.list();
    const items = await mergeTaskPage(
      workspaces.map(
        (workspace) => async (offset, limit) =>
          (await this.list({ workspaceId: workspace.id }, { ...page, offset, limit })).items
      ),
      page.offset,
      page.limit
    );
    return { items, offset: page.offset, limit: page.limit };
  }

  /**
   * Search all trusted workspaces and carry each run's owning scope into detail navigation.
   */
  async historyCatalog(query: unknown) {
    const parsed = scheduledHistoryQuerySchema
      .safeExtend({ workspaceId: z.string().min(1).max(200).optional() })
      .safeParse(query);
    if (!parsed.success) {
      throw this.invalid();
    }
    const { workspaceId, ...page } = parsed.data;
    const workspaces = workspaceId
      ? [await this.options.workspaces.resolve({ id: workspaceId })]
      : await this.options.workspaces.list();
    const readers = workspaces.map((workspace) => async (offset: number, limit: number) => {
      const result = await this.history({ workspaceId: workspace.id }, '', { ...page, offset, limit });
      return result.items.map((run) => ({
        ...run,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
      }));
    });
    const items = await mergeSortedPage(readers, page.offset, page.limit, (left, right) => {
      const time = Date.parse(right.scheduledFor) - Date.parse(left.scheduledFor);
      return time || (left.id === right.id ? 0 : left.id > right.id ? -1 : 1);
    });
    return { items, offset: page.offset, limit: page.limit };
  }

  /**
   * Return a Workspace-scoped task page from the Agent daemon.
   */
  async list(scope: SchedulerScope, query: unknown) {
    const page = scheduledTaskQuerySchema.safeParse(query);
    if (!page.success) {
      throw this.invalid();
    }
    const client = await this.client(scope.workspaceId);
    const result = await this.invoke(
      () =>
        client.request({ operation: 'list', input: page.data }, this.caller(scope)) as Promise<{
          items: SchedulerTask[];
          limit: number;
          offset: number;
        }>
    );
    return { ...result, items: result.items.map((task) => this.projectTask(task)) };
  }

  /**
   * Resolve a task through the trusted Workspace fence.
   */
  async get(scope: SchedulerScope, id: string) {
    const client = await this.client(scope.workspaceId);
    const task = await this.invoke(() => client.get(id, this.caller(scope)));
    return this.projectTask(task);
  }

  /**
   * Read retained Run history through the same Workspace fence.
   */
  async history(scope: SchedulerScope, id: string, query: unknown) {
    const page = scheduledHistoryQuerySchema.safeParse(query);
    if (!page.success) {
      throw this.invalid();
    }
    const client = await this.client(scope.workspaceId);
    return this.invoke(
      () =>
        client.request(
          { operation: 'history', ...(id ? { taskId: id } : {}), input: page.data },
          this.caller(scope)
        ) as Promise<{ items: ScheduledHistoryRun[]; limit: number; offset: number }>
    );
  }

  /**
   * Forward existing-task mutations, including user-controlled archive recovery and purge.
   * Creation belongs exclusively to conversation tools.
   */
  async mutate(scope: SchedulerScope, request: SchedulerMutationRequest): Promise<ScheduledMutation> {
    if (
      ![
        'update',
        'delete',
        'restore',
        'purge',
        'run-now',
        'cancel',
        'authorize',
        'revoke-authorization',
      ].includes(request.operation)
    ) {
      throw this.invalid();
    }
    const client = await this.client(scope.workspaceId);
    const result = await this.invoke(
      () =>
        client.request(
          {
            operation: request.operation,
            key: request.key,
            ...(request.taskId ? { taskId: request.taskId } : {}),
            ...(request.revision === undefined ? {} : { revision: request.revision }),
            input: request.input,
          },
          this.caller(scope)
        ) as Promise<SchedulerTaskMutation>
    );
    if (result.effect === 'purged') {
      await this.options.onPurged?.(scope.workspaceId, result.task.id);
    }
    return { ...result, task: this.projectTask(result.task) };
  }

  /**
   * Report daemon status without starting another Server-owned worker.
   */
  async transcript(scope: SchedulerScope, id: string, runId: string) {
    const client = await this.client(scope.workspaceId);
    return this.invoke(() =>
      client.request({ operation: 'transcript', taskId: id, input: { runId } }, this.caller(scope))
    );
  }

  /**
   * Read a settled artifact through the trusted control token; never return this object directly to browsers.
   */
  async result(workspaceId: string, taskId: string, runId: string): Promise<SchedulerResult> {
    const client = await this.client(workspaceId);
    return this.invoke(
      () => client.request({ operation: 'run-result', taskId, input: { runId } }) as Promise<SchedulerResult>
    );
  }

  /**
   * Inspect actual tools for explicit user review without executing a model prompt.
   */
  async authorizationPreview(scope: SchedulerScope, id: string) {
    const client = await this.client(scope.workspaceId);
    return this.invoke(() =>
      client.request({ operation: 'authorization-preview', taskId: id }, this.caller(scope))
    );
  }

  /**
   * Read the independent scheduler status without starting a worker.
   */
  async status() {
    const status = await (this.options.readStatus ?? getSchedulerServiceStatus)(this.options.agentDir);
    return this.projectServiceStatus(status);
  }

  /**
   * Apply an explicit lifecycle action to the shared Agent-owned daemon.
   */
  async control(action: 'start' | 'stop' | 'restart') {
    const operation =
      action === 'start'
        ? (this.options.startService ?? startSchedulerService)
        : action === 'stop'
          ? (this.options.stopService ?? stopSchedulerService)
          : (this.options.restartService ?? restartSchedulerService);
    const status = await this.invoke(() => operation(this.options.agentDir));
    return this.projectServiceStatus(status);
  }

  /**
   * Read global Scheduler configuration from the Agent-owned cron.json contract.
   */
  settings() {
    return (this.options.readSettings ?? getSchedulerSettings)(this.options.agentDir);
  }

  /**
   * Replace global Scheduler configuration through its Agent-owned revision fence.
   */
  updateSettings(input: unknown) {
    return this.invoke(() =>
      (this.options.updateSettings ?? updateSchedulerSettings)(
        this.options.agentDir,
        input as SchedulerSettingsUpdate
      )
    );
  }

  /**
   * Release transport clients only; Server shutdown never stops the shared daemon.
   */
  close(): void {
    for (const value of this.clients.values()) {
      value.client.close();
    }
    this.clients.clear();
  }

  /**
   * Resolve the current Workspace descriptor and replace clients when its execution revision changes.
   */
  private async client(workspaceId: string): Promise<AgentSchedulerClient> {
    const workspace = await this.options.workspaces.resolve({ id: workspaceId });
    const existing = this.clients.get(workspace.id);
    if (existing?.cwd === workspace.cwd && existing.configRevision === workspace.updatedAt) {
      return existing.client;
    }
    existing?.client.close();
    const client = (this.options.createClient ?? createSchedulerClient)({
      agentDir: this.options.agentDir,
      workspaceId: workspace.id,
      cwd: workspace.cwd,
      configRevision: workspace.updatedAt,
    });
    this.clients.set(workspace.id, { cwd: workspace.cwd, configRevision: workspace.updatedAt, client });
    return client;
  }

  /**
   * Keep source Session metadata outside browser/model task bodies.
   */
  private caller(scope: SchedulerScope): { originSessionRef?: string } {
    return scope.sessionId ? { originSessionRef: scope.sessionId } : {};
  }

  /**
   * Translate Agent ownership identity into the Server's public Session catalog identity.
   */
  private projectTask(task: SchedulerTask): ScheduledTask {
    const { originSessionRef, ...publicTask } = task;
    return {
      ...publicTask,
      targetSessionId:
        originSessionRef === null
          ? null
          : this.options.sessions.findSessionIdByAgentRef(task.workspaceId, originSessionRef),
    };
  }

  /**
   * Expose operational diagnostics while withholding daemon discovery and process identity.
   */
  private projectServiceStatus(status: SchedulerServiceStatus) {
    if (status.state !== 'control-ready') {
      return { state: status.state };
    }
    return {
      state: status.state,
      taskControlReady: status.taskControlReady,
      executionReady: status.executionReady,
      active: status.active,
      degraded: status.degraded,
      lastScanAt: status.lastScanAt,
      queued: status.queued,
      running: status.running,
      nextRunAt: status.nextRunAt,
    };
  }

  /**
   * Translate Agent domain failures into the Server's existing safe public envelope.
   */
  private async invoke<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (cause) {
      const code =
        cause !== null && typeof cause === 'object' && typeof (cause as { code?: unknown }).code === 'string'
          ? (cause as { code: string }).code
          : 'SCHEDULE_UNAVAILABLE';
      const message = cause instanceof Error ? cause.message : 'Scheduler request failed';
      const statusCode = code.endsWith('_NOT_FOUND')
        ? 404
        : code === 'SCHEDULE_AUTHORIZATION_REQUIRED'
          ? 403
          : code.includes('CONFLICT') || code.includes('REVISION') || code.includes('CANCELLABLE')
            ? 409
            : code.includes('INVALID') || code.includes('TIMEZONE')
              ? 400
              : 503;
      throw new ApplicationError(code, message, { statusCode, cause });
    }
  }

  /**
   * Reject malformed Host adapter inputs without leaking their values.
   */
  private invalid(): ApplicationError {
    return new ApplicationError('SCHEDULE_INVALID', 'Invalid scheduled-task request.', {
      statusCode: 400,
    });
  }
}
