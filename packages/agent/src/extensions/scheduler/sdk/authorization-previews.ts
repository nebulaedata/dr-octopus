/**
 * @author Codex
 * @description Coalesces explicit catalog requests and retains bounded, short-lived results for approval without reinitialization.
 */
import { executionDigest } from '../services/execution-digest.js';
import { SchedulerTaskError } from '../definitions/task-error.js';
import type { SchedulerTaskRecord } from '../definitions/tasks.js';
import type { TaskToolCatalogEntry } from '@octopus/shared/protocol/scheduled-tasks';

interface PreviewRecord {
  taskKey: string;
  configuration: string;
  expiresAt: number;
  tools: TaskToolCatalogEntry[];
}

/**
 * Own one daemon-local preview window; no result grants authority and no approval may start a probe.
 */
export class AuthorizationPreviews {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly pending = new Map<string, Promise<TaskToolCatalogEntry[]>>();
  private readonly completed = new Map<string, PreviewRecord>();

  /**
   * Inject configuration reads separately from initialization so approval remains observational.
   */
  constructor(
    private readonly inspect: (task: SchedulerTaskRecord) => Promise<TaskToolCatalogEntry[]>,
    private readonly configuration: (task: SchedulerTaskRecord) => Promise<string>,
    private readonly now: () => number = Date.now
  ) {}

  /**
   * Bind a preview to the exact task revision and execution content.
   */
  private key(task: SchedulerTaskRecord): string {
    return JSON.stringify([task.id, task.revision, task.cwd, executionDigest(task)]);
  }

  /**
   * Explicit list requests refresh completed results but share a currently running or queued inspection.
   */
  async request(task: SchedulerTaskRecord): Promise<TaskToolCatalogEntry[]> {
    const key = this.key(task);
    const pending = this.pending.get(key);
    if (pending) {
      return structuredClone(await pending);
    }
    if (this.pending.size >= 16) {
      throw new SchedulerTaskError(
        'SCHEDULE_AUTHORIZATION_UNAVAILABLE',
        'Too many tool inspections; retry shortly.'
      );
    }
    this.completed.delete(task.id);
    const operation = this.tail.then(async () => {
      const before = await this.configuration(task);
      const tools = await this.inspect(task);
      if (before !== (await this.configuration(task))) {
        throw new SchedulerTaskError(
          'SCHEDULE_TASK_CONFLICT',
          'Extension configuration changed; refresh the authorization list.'
        );
      }
      this.prune();
      if (this.completed.size >= 16) {
        this.completed.delete(this.completed.keys().next().value!);
      }
      this.completed.set(task.id, {
        taskKey: key,
        configuration: before,
        expiresAt: this.now() + 120_000,
        tools: structuredClone(tools),
      });
      return tools;
    });
    this.pending.set(key, operation);
    this.tail = operation.catch(() => undefined);
    try {
      return structuredClone(await operation);
    } finally {
      this.pending.delete(key);
    }
  }

  /**
   * Return only a still-current reviewed catalog; missing/expired results require an explicit list refresh.
   */
  async reviewed(task: SchedulerTaskRecord): Promise<TaskToolCatalogEntry[]> {
    this.prune();
    const record = this.completed.get(task.id);
    if (!record || record.taskKey !== this.key(task) || this.pending.has(this.key(task))) {
      throw new SchedulerTaskError(
        'SCHEDULE_TASK_CONFLICT',
        'Open or refresh the authorization list before approving.'
      );
    }
    const current = await this.configuration(task);
    if (
      this.completed.get(task.id) !== record ||
      record.expiresAt <= this.now() ||
      record.configuration !== current
    ) {
      this.completed.delete(task.id);
      throw new SchedulerTaskError(
        'SCHEDULE_TASK_CONFLICT',
        'Authorization preview expired or configuration changed; refresh the list.'
      );
    }
    return structuredClone(record.tools);
  }

  /**
   * Drop expired catalogs without timers or persistence.
   */
  private prune(): void {
    for (const [id, record] of this.completed) {
      if (record.expiresAt <= this.now()) {
        this.completed.delete(id);
      }
    }
  }
}
