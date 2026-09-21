/**
 * @author Codex
 * @description Imports settled Scheduler Sessions and reconciles durable notifications independently of execution.
 */
import { resolve } from 'node:path';
import { ApplicationError } from '../../lib/errors/application-error.js';
import { ScheduledResultArtifacts } from './scheduled-result-artifacts.js';
import { projectExecutionMessage } from './execution-message-projection.js';
import type { ScheduledTasksService } from './scheduled-tasks.service.js';
import type { SessionsService } from '../sessions/sessions.service.js';
import type { SessionNotificationsRepository } from '../sessions/session-notifications.repository.js';
import type { WorkspacesService } from '../workspaces/workspaces.service.js';

/**
 * Run bounded catch-up sweeps without reserving a model runtime or relying on transient events.
 */
export class ScheduledResultsService {
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
    private readonly notices: SessionNotificationsRepository,
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
      const message =
        entry.type === 'message'
          ? entry.message
          : entry.type === 'custom_message'
            ? { role: 'system', content: entry.content }
            : { role: 'system', content: '' };
      const content =
        'content' in message
          ? message.content
          : 'output' in message
            ? message.output
            : 'summary' in message
              ? message.summary
              : '';
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
