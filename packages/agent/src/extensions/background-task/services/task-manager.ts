/**
 * @author Codex
 * @description Owns bounded background task records, launch admission and idempotent stop barriers.
 */
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { isBackgroundTaskActive } from '@octopus/shared/protocol';
import type { BackgroundTaskDto, BackgroundTasksSnapshot } from '@octopus/shared/protocol';
import type { ManagedProcess, ProcessLauncher } from '../definitions/port.js';

interface RecordEntry {
  task: BackgroundTaskDto;
  key: string;
  input: string;
  process?: ManagedProcess;
  output: Buffer;
  offset: number;
  completedOrder?: number;
}

/**
 * A manager belongs to exactly one loaded extension instance; no external owner IDs are accepted.
 */
export class BackgroundTaskManager {
  readonly generation = randomUUID();
  private readonly records = new Map<string, RecordEntry>();
  private accepting = true;
  private revision = 0;
  private completionSequence = 0;
  private stopId?: string;
  private error?: string;
  private logs?: BackgroundTasksSnapshot['logs'];
  private listener: (snapshot: BackgroundTasksSnapshot) => void = () => undefined;

  /**
   * Injects the process boundary without performing work during extension discovery.
   */
  constructor(private readonly launcher: ProcessLauncher) {}

  /**
   * Attaches the current session projection sink.
   */
  observe(listener: (snapshot: BackgroundTasksSnapshot) => void): void {
    this.listener = listener;
    this.publish();
  }

  /**
   * Returns a complete bounded ownership snapshot, including unconfirmed resources.
   */
  snapshot(): BackgroundTasksSnapshot {
    const tasks = [...this.records.values()].map((entry) => ({ ...entry.task }));
    return {
      schemaVersion: 1,
      generation: this.generation,
      revision: this.revision,
      accepting: this.accepting,
      stopId: this.stopId,
      activeCount: tasks.filter(isBackgroundTaskActive).length,
      tasks,
      error: this.error,
      logs: this.logs ? { ...this.logs } : undefined,
    };
  }

  /**
   * Registers starting work synchronously before any asynchronous process creation.
   */
  async start(
    command: string,
    cwd: string,
    label: string,
    key: string,
    signal?: AbortSignal
  ): Promise<BackgroundTaskDto> {
    signal?.throwIfAborted();
    if (!this.accepting) {
      throw new Error('SESSION_STOPPING');
    }
    const input = JSON.stringify([command, cwd, label]);
    const duplicate = [...this.records.values()].find((entry) => entry.key === key);
    if (duplicate) {
      if (duplicate.input !== input) {
        throw new Error('REQUEST_ID_CONFLICT');
      }
      return { ...duplicate.task };
    }
    if (this.snapshot().activeCount >= 8) {
      throw new Error('TASK_LIMIT_REACHED');
    }
    const entry: RecordEntry = {
      task: { taskId: randomUUID(), label, state: 'starting', createdAt: Date.now() },
      key,
      input,
      output: Buffer.alloc(0),
      offset: 0,
    };
    this.records.set(entry.task.taskId, entry);
    this.publish();
    try {
      entry.process = await this.launcher.launch(command, cwd, (data) => {
        const combined = Buffer.concat([entry.output, data]);
        const removed = Math.max(0, combined.length - 1024 * 1024);
        entry.offset += removed;
        entry.output = Buffer.from(combined.subarray(removed));
      });
      void entry.process.done.then(
        ({ exitCode }) => {
          entry.task.exitCode = exitCode;
          entry.task.state = entry.task.state === 'stopping' ? 'stopped' : 'exited';
          entry.task.endedAt = Date.now();
          entry.completedOrder = ++this.completionSequence;
          entry.process = undefined;
          this.publish();
        },
        () => {
          entry.task.state = 'unknown';
          entry.task.error = 'OWNERSHIP_UNCONFIRMED';
          this.publish();
        }
      );
      if (!this.accepting || signal?.aborted || entry.task.state === 'stopping') {
        entry.task.state = 'stopping';
        entry.process.stop();
      } else {
        entry.task.state = 'running';
      }
      this.publish();
      signal?.throwIfAborted();
      return { ...entry.task };
    } catch (error) {
      if (!entry.process && entry.task.state !== 'stopped' && entry.task.state !== 'exited') {
        entry.task.state = 'failed';
        entry.task.error = 'SPAWN_FAILED';
        entry.task.endedAt = Date.now();
        entry.completedOrder = ++this.completionSequence;
      }
      this.publish();
      throw error;
    }
  }

  /**
   * Looks up only tasks owned by this runtime instance.
   */
  status(taskId: string): BackgroundTaskDto {
    return { ...this.require(taskId).task };
  }

  /**
   * Returns bytes after an absolute cursor, preserving truncation evidence after ring eviction.
   */
  readLogs(taskId: string, cursor?: number, limitBytes = 16384) {
    const entry = this.require(taskId);
    const start = cursor ?? Math.max(entry.offset, entry.offset + entry.output.length - limitBytes);
    const relative = Math.max(0, Math.min(entry.output.length, start - entry.offset));
    const bytes = entry.output.subarray(relative, relative + Math.min(limitBytes, 65536));
    return {
      taskId,
      text: bytes.toString('utf8'),
      nextCursor: entry.offset + relative + bytes.length,
      truncated: start < entry.offset || (cursor === undefined && entry.offset + relative > 0),
    };
  }

  /**
   * Publishes an explicitly requested bounded log view, never automatic log flooding.
   */
  showLogs(taskId: string): void {
    this.logs = this.readLogs(taskId);
    this.error = undefined;
    this.publish();
  }

  /**
   * Clears stale command errors only after successful control, without changing task or admission state.
   */
  clearError(): void {
    if (this.error !== undefined) {
      this.error = undefined;
      this.publish();
    }
  }

  /**
   * Publishes command failures because Pi may acknowledge commands whose handlers threw.
   */
  reportError(): void {
    this.error = 'BACKGROUND_CONTROL_FAILED: inspect task state and retry the control.';
    this.publish();
  }

  /**
   * Cancels one process scope; cancellation of a wait is deliberately separate.
   */
  stop(taskId: string): void {
    const entry = this.require(taskId);
    if (!isBackgroundTaskActive(entry.task)) {
      return;
    }
    entry.task.state = 'stopping';
    this.publish();
    try {
      entry.process?.stop();
    } catch {
      entry.task.error = 'STOP_UNCONFIRMED';
      this.publish();
    }
  }

  /**
   * Atomically closes admission before requesting termination; retries replace only the stop identity.
   */
  beginStop(stopId: string): void {
    this.accepting = false;
    this.stopId = stopId;
    this.error = undefined;
    for (const entry of this.records.values()) {
      this.stop(entry.task.taskId);
    }
    this.publish();
  }

  /**
   * Releases a matching empty barrier only after the Host has confirmed all cancellation domains.
   */
  finishStop(stopId: string): void {
    if (this.stopId !== stopId || this.snapshot().activeCount !== 0) {
      throw new Error('STOP_UNCONFIRMED');
    }
    this.accepting = true;
    this.publish();
  }

  /**
   * Waits within a finite budget without transferring cancellation to the process.
   */
  async wait(taskId: string, timeoutMs = 10000, signal?: AbortSignal): Promise<BackgroundTaskDto> {
    // Hold the observation independently of the bounded history index until this waiter settles.
    const entry = this.require(taskId);
    const deadline = Date.now() + timeoutMs;
    while (isBackgroundTaskActive(entry.task) && Date.now() < deadline) {
      await delay(Math.min(50, Math.max(1, deadline - Date.now())), undefined, { signal });
    }
    signal?.throwIfAborted();
    return { ...entry.task };
  }

  /**
   * Tears down all owned resources without reopening admission.
   */
  async dispose(): Promise<void> {
    this.beginStop('shutdown');
    await Promise.all([...this.records.keys()].map((id) => this.wait(id, 10000)));
    if (this.snapshot().activeCount) {
      throw new Error('STOP_TIMEOUT');
    }
  }

  /**
   * Publishes state changes while retaining active records and bounded terminal history.
   */
  publish(): void {
    const terminal = [...this.records.values()]
      .filter((entry) => !isBackgroundTaskActive(entry.task))
      .sort((a, b) => (a.completedOrder ?? 0) - (b.completedOrder ?? 0));
    for (const entry of terminal.slice(0, Math.max(0, terminal.length - 100))) {
      this.records.delete(entry.task.taskId);
    }
    this.revision++;
    this.listener(this.snapshot());
  }

  /**
   * Resolves an opaque identity without inspecting or killing external PIDs.
   */
  private require(taskId: string): RecordEntry {
    const record = this.records.get(taskId);
    if (!record) {
      throw new Error('TASK_NOT_FOUND');
    }
    return record;
  }
}
