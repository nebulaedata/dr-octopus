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
  scheduledHistoryQuerySchema,
  scheduledTaskQuerySchema,
} from '@octopus/shared/protocol/scheduled-tasks';
import { z } from 'zod';
import { ApplicationError } from '../../infrastructure/errors/application-error.js';
import { mergeSortedPage, mergeTaskPage } from './scheduled-tasks.utils.js';
import { resolve } from 'node:path';
import { projectExecutionMessage } from './scheduled-tasks.utils.js';
import { ScheduledResultArtifacts } from './scheduled-tasks.repository.js';
import type {
  AgentSchedulerClient,
  SchedulerResult,
  SchedulerServiceStatus,
  SchedulerSettingsUpdate,
  SchedulerTask,
  SchedulerTaskMutation,
} from '@octopus/agent';
import type {
  ScheduledHistoryRun,
  ScheduledMutation,
  ScheduledTask,
} from '@octopus/shared/protocol/scheduled-tasks';
import type { SessionsService } from '../sessions/index.js';
import type { WorkspacesService } from '../workspaces/index.js';

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
      if (time) {
        return time;
      }
      if (left.id === right.id) {
        return 0;
      }
      return left.id > right.id ? -1 : 1;
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
    let operation;
    if (action === 'start') {
      operation = this.options.startService ?? startSchedulerService;
    } else {
      if (action === 'stop') {
        operation = this.options.stopService ?? stopSchedulerService;
      } else {
        operation = this.options.restartService ?? restartSchedulerService;
      }
    }
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
      let statusCode: number;
      if (code.endsWith('_NOT_FOUND')) {
        statusCode = 404;
      } else {
        if (code === 'SCHEDULE_AUTHORIZATION_REQUIRED') {
          statusCode = 403;
        } else {
          if (code.includes('CONFLICT') || code.includes('REVISION') || code.includes('CANCELLABLE')) {
            statusCode = 409;
          } else {
            if (code.includes('INVALID') || code.includes('TIMEZONE')) {
              statusCode = 400;
            } else {
              statusCode = 503;
            }
          }
        }
      }
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

/**
 * Run bounded catch-up sweeps without reserving a model runtime or relying on transient events.
 */
export class ScheduledResultSynchronization {
  private readonly artifacts: ScheduledResultArtifacts;
  private readonly offsets = new Map<string, number>();
  private readonly importing = new Map<string, Promise<string>>();
  private sweep: Promise<void> | undefined;
  private cleanupOffset = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private requested = false;
  private running = false;
  /**
   * Inject trusted Host services and the report-file directory.
   */
  constructor(
    private readonly scheduler: ScheduledTasksService,
    private readonly sessions: SessionsService,
    private readonly notices: SessionsService['notifications'],
    private readonly workspaces: WorkspacesService,
    directory: string,
    private readonly onError: (error: unknown) => void
  ) {
    this.artifacts = new ScheduledResultArtifacts(directory);
  }

  /**
   * Start one self-scheduling sweep; shutdown waits for an outstanding sweep before closing storage.
   */
  start(): void {
    if (this.timer || this.closed) {
      return;
    }
    this.timer = setTimeout(() => {
      void this.tick();
    }, 1000);
    this.timer.unref();
  }
  /**
   * Coalesce daemon invalidations, retaining a trailing pass when an import is already running.
   */
  requestSync(): void {
    if (this.closed) {
      return;
    }
    this.requested = true;
    if (this.running) {
      return;
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.tick();
    }, 100);
    this.timer.unref();
  }
  /**
   * Stop result reconciliation without stopping the independent Scheduler daemon.
   */
  async close(): Promise<void> {
    this.closed = true;
    clearTimeout(this.timer);
    await this.sweep;
    await Promise.allSettled(this.importing.values());
  }
  /**
   * Serialize each run import across background scans and explicit result navigation.
   */
  ensure(workspaceId: string, taskId: string, runId: string): Promise<string> {
    if (this.closed) {
      return Promise.reject(
        new ApplicationError('SCHEDULE_STOPPING', 'Result synchronization is stopping.', { statusCode: 503 })
      );
    }
    const key = `${workspaceId}:${runId}`;
    const current = this.importing.get(key);
    if (current) {
      return current;
    }
    const promise = this.importResult(workspaceId, taskId, runId).finally(() => this.importing.delete(key));
    this.importing.set(key, promise);
    return promise;
  }
  /**
   * Return a paginated, read-only branch after rechecking authoritative run ownership.
   */
  async view(workspaceId: string, sessionId: string, offset: number) {
    await this.sessions.assertWorkspaceSession(workspaceId, sessionId);
    const session = this.sessions.getSession(sessionId);
    if (!session.execution) {
      throw new ApplicationError('SESSION_NOT_EXECUTION', 'Not an execution Session.', { statusCode: 400 });
    }
    const result = await this.scheduler.result(
      workspaceId,
      session.execution.taskId,
      session.execution.runId
    );
    const artifact = result.session ?? (await this.artifacts.report(result));
    const entries = this.artifacts.pi
      .getBranch(artifact.path)
      .filter((entry) => entry.type === 'message' || (entry.type === 'custom_message' && entry.display));
    const end = Math.max(0, entries.length - offset);
    const items = entries.slice(Math.max(0, end - 20), end).flatMap((entry) => {
      let message;
      if (entry.type === 'message') {
        message = entry.message;
      } else {
        if (entry.type === 'custom_message') {
          message = { role: 'system', content: entry.content };
        } else {
          message = { role: 'system', content: '' };
        }
      }
      let content: unknown;
      if ('content' in message) {
        content = message.content;
      } else {
        if ('output' in message) {
          content = message.output;
        } else {
          if ('summary' in message) {
            content = message.summary;
          } else {
            content = '';
          }
        }
      }
      return projectExecutionMessage(
        entry.id,
        message.role,
        message.role === 'user' ? result.prompt : content
      );
    });
    return { session, run: result.run, prompt: result.prompt, items, hasMore: end > 20, offset };
  }
  /**
   * Import into one transaction so a crash cannot leave a visible Session without its notification.
   */
  private async importResult(workspaceId: string, taskId: string, runId: string): Promise<string> {
    const result = await this.scheduler.result(workspaceId, taskId, runId);
    const receipt = this.notices.findRun(workspaceId, runId);
    if (receipt) {
      this.sessions.getSession(receipt.sessionId);
      return receipt.sessionId;
    }
    const artifact = result.session ?? (await this.artifacts.report(result));
    const metadata = await this.artifacts.pi.readMetadata(artifact.path);
    if (metadata.sessionId !== artifact.id || resolve(metadata.cwd) !== resolve(result.cwd)) {
      throw new ApplicationError('SCHEDULE_ARTIFACT_INVALID', 'Run Session metadata does not match.', {
        statusCode: 503,
      });
    }
    const id = `scheduled-${runId}`;
    const createdAt = result.run.settledAt ?? result.run.createdAt;
    const originSessionId = result.originSessionRef
      ? this.sessions.findSessionIdByAgentRef(workspaceId, result.originSessionRef)
      : null;
    this.notices.registerResult(
      {
        id,
        workspaceId,
        agentSessionId: artifact.id,
        agentSessionPath: artifact.path,
        title: `${result.taskName} · ${new Date(result.run.scheduledFor).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
        createdAt,
        updatedAt: createdAt,
        lastMessageAt: createdAt,
        execution: { taskId, runId, status: result.run.status },
      },
      {
        eventKey: `scheduled:${workspaceId}:${runId}`,
        workspaceId,
        sessionId: id,
        originSessionId,
        taskId,
        runId,
        title: result.taskName,
        summary: (result.run.summary ?? result.run.errorCode ?? result.run.status).slice(0, 500),
        status: result.run.status,
        createdAt,
      }
    );
    return id;
  }
  /**
   * Revisit every history page, including old runs that settled after a previous scan passed them.
   */
  private async synchronize(): Promise<void> {
    if ((await this.scheduler.status()).state !== 'control-ready') {
      return;
    }
    for (const workspace of await this.workspaces.list()) {
      if (this.closed) {
        return;
      }
      try {
        const offset = this.offsets.get(workspace.id) ?? 0;
        const head = await this.scheduler.history({ workspaceId: workspace.id }, '', {
          offset: 0,
          limit: 50,
        });
        const page =
          offset === 0
            ? head
            : await this.scheduler.history({ workspaceId: workspace.id }, '', { offset, limit: 50 });
        for (const run of offset === 0 ? page.items : [...head.items, ...page.items]) {
          if (!run.settledAt || run.status === 'skipped' || this.notices.findRun(workspace.id, run.id)) {
            continue;
          }
          try {
            await this.ensure(workspace.id, run.taskId, run.id);
          } catch (error) {
            this.onError(error);
          }
        }
        this.offsets.set(workspace.id, page.items.length === 50 ? offset + 50 : 0);
      } catch (error) {
        this.onError(error);
      }
    }
    await this.reconcile();
  }
  /**
   * Remove dangling catalog links only when Agent confirms deletion, never on transport failures.
   */
  async reconcile(): Promise<void> {
    const receipts = this.notices.runReceipts(this.cleanupOffset);
    for (const receipt of receipts) {
      if (!receipt.taskId || !receipt.runId) {
        continue;
      }
      try {
        await this.scheduler.result(receipt.workspaceId, receipt.taskId, receipt.runId);
      } catch (error) {
        if (!(error instanceof ApplicationError) || error.code !== 'SCHEDULE_RUN_NOT_FOUND') {
          continue;
        }
        await this.artifacts.removeReport(receipt.runId);
        this.notices.removeRun(receipt.workspaceId, receipt.runId);
      }
    }
    this.cleanupOffset = receipts.length === 50 ? this.cleanupOffset + 50 : 0;
  }

  /**
   * Finish Host cleanup after an acknowledged purge; restart reconciliation retries interrupted cleanup.
   */
  async purgeTask(workspaceId: string, taskId: string): Promise<void> {
    await Promise.allSettled(this.importing.values());
    for (;;) {
      const receipts = this.notices.taskReceipts(workspaceId, taskId);
      if (!receipts.length) {
        return;
      }
      for (const receipt of receipts) {
        if (!receipt.runId) {
          throw new Error('Scheduler receipt has no run identity');
        }
        await this.artifacts.removeReport(receipt.runId);
        this.notices.removeRun(workspaceId, receipt.runId);
      }
    }
  }
  /**
   * Serialize event-triggered synchronization and retain low-frequency recovery after completion.
   */
  private async tick(): Promise<void> {
    if (this.closed || this.running) {
      return;
    }
    this.running = true;
    this.requested = false;
    this.sweep = this.synchronize().catch(this.onError);
    await this.sweep;
    this.running = false;
    if (!this.closed) {
      this.timer = setTimeout(
        () => {
          void this.tick();
        },
        this.requested ? 100 : 60_000
      );
      this.timer.unref();
    }
  }
}
