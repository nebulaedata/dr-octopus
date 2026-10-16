/**
 * @author Codex
 * @description Owns seven Basic tools through one authorized task queue, observation cache, operation history and shutdown.
 */
import {
  BasicToolError,
  readInputSchema,
  writeInputSchema,
  editInputSchema,
  shellInputSchema,
} from './basic-inputs';
import type { ShellExecutor, ShellResult } from './shell-executor';
import type { ShellStatus } from './shell-platform';
import type { SearchTools, SearchResult } from './search-tools';
import { lsInputSchema, findInputSchema, grepInputSchema } from './search-inputs';
import type { EditInput } from './basic-inputs';
import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { resolveLocalDirectory, resolveReadableFile, resolveMutationFile } from './file-policy';
import { pageText, readTextSnapshot } from './text-file';
import type { ReadResult } from './text-file';
import type { FilePublication, PublicationResult } from './file-publication';
import { prepareEdit } from './edit-plan';
import { describeEdit } from './edit-diff';
import type { EditDiff } from './edit-diff';
import type { z } from 'zod';

type WriteInput = z.infer<typeof writeInputSchema>;
type Mutation = { kind: 'write'; input: WriteInput } | { kind: 'edit'; input: EditInput };
export type FileMutationResult = PublicationResult & {
  executionState: 'quiescent';
  fileEffect: 'applied' | 'not_applied' | 'unknown';
  replacements?: number;
  diff?: EditDiff;
};

type Task = {
  ownerId: string;
  cwd: string;
  permissions: ReadonlySet<'files.read' | 'files.write' | 'shell.execute'>;
  observations: Map<string, string>;
  tail: Promise<void>;
  queued: number;
  state: 'registering' | 'active' | 'stopping' | 'stopped' | 'isolated';
  operations: Map<string, { fingerprint: string; pending: Promise<FileMutationResult | ShellResult> }>;
  shellAbort: AbortController | null;
  isolation: { code: string; recoveryId: string | null } | null;
};

export class BasicTools {
  private readonly outputReads = new Set<Promise<unknown>>();
  private readonly tasks = new Map<string, Task>();
  private activeReads = 0;
  private mutationTail: Promise<void> = Promise.resolve();
  private mutationBytes = 0;
  private operationCount = 0;
  private closing = false;

  /**
   * Shares one publication backend across all tasks; task permissions are enforced before backend admission.
   */
  constructor(
    private readonly publication: FilePublication,
    private readonly shell?: ShellExecutor,
    private readonly search?: SearchTools
  ) {}

  /**
   * Projects cached Shell availability independently from file and search capabilities.
   */
  shellStatus(): ShellStatus {
    return (
      this.shell?.status() ?? { kind: 'powershell', version: null, available: false, code: 'SHELL_NOT_FOUND' }
    );
  }

  /**
   * Revokes retained Shell material for a Host-confirmed owner/task, including tasks from earlier Runtime runs.
   */
  async revokeOutput(ownerId: string, taskId: string): Promise<void> {
    await this.shell?.revokeOutput(ownerId, taskId);
  }

  /**
   * Registers a task only from trusted Host code after device capability authorization.
   * Copies grants; no tool request can create a task, change cwd or add a permission.
   */
  async registerTask(grant: {
    taskId: string;
    ownerId: string;
    cwd: string;
    permissions: readonly ('files.read' | 'files.write' | 'shell.execute')[];
  }): Promise<void> {
    if (
      this.closing ||
      !grant.taskId.trim() ||
      grant.taskId.trim() !== grant.taskId ||
      grant.taskId.length > 128 ||
      !grant.ownerId.trim() ||
      grant.ownerId.length > 128
    ) {
      throw new BasicToolError('INVALID_TASK', 'The Host task grant is invalid.');
    }
    if (
      this.publication.hasTaskHistory(grant.ownerId, grant.taskId) ||
      this.shell?.hasTaskHistory(grant.ownerId, grant.taskId)
    ) {
      throw new BasicToolError(
        'TASK_ID_REUSED',
        'A prior mutation task cannot be registered as a fresh task.'
      );
    }
    if (
      this.tasks.has(grant.taskId) ||
      this.tasks.size >= 1000 ||
      [...this.tasks.values()].filter(
        (task) => task.state === 'active' || task.state === 'registering' || task.state === 'stopping'
      ).length >= 100
    ) {
      throw new BasicToolError('TASK_LIMIT', 'The task already exists or the active task limit was reached.');
    }
    // Reserve before awaiting directory checks so concurrent registrations cannot replace a live task.
    const task: Task = {
      ownerId: grant.ownerId,
      cwd: '',
      permissions: new Set(grant.permissions),
      observations: new Map(),
      tail: Promise.resolve(),
      queued: 0,
      state: 'registering',
      operations: new Map(),
      isolation: null,
      shellAbort: null,
    };
    const taskId = grant.taskId;
    const cwd = grant.cwd;
    this.tasks.set(taskId, task);
    const registration = (async () => {
      try {
        task.cwd = grant.permissions.length ? await resolveLocalDirectory(cwd) : cwd;
        if (this.closing) {
          throw new BasicToolError('TASK_STOPPED', 'The Runtime is shutting down.');
        }
        task.state = 'active';
      } catch (error) {
        this.tasks.delete(taskId);
        throw error;
      }
    })();
    task.tail = registration.then(
      () => {},
      () => {}
    );
    await registration;
  }

  /**
   * Reads under an existing owner-bound task. Mid-file requests require a version or task observation.
   * Failed reads never update observations; fresh reads from the beginning can establish a newer version.
   */
  async read(ownerId: string, request: unknown): Promise<ReadResult> {
    const parsed = readInputSchema.safeParse(request);
    if (!parsed.success) {
      throw new BasicToolError('INVALID_INPUT', 'The read request does not match the supported schema.');
    }
    const input = parsed.data;
    if (input.path.startsWith('executor-output:')) {
      if (this.closing) {
        throw new BasicToolError('TASK_STOPPED', 'The Runtime is shutting down.');
      }
      const match = /^(executor-output:\/\/[0-9a-f-]{36})\/(stdout|stderr)$/.exec(input.path);
      if (!match || input.offset !== undefined || input.limit !== undefined || !this.shell) {
        throw new BasicToolError(
          'INVALID_INPUT',
          'Shell output uses an authorized stdout/stderr URI and byte paging.'
        );
      }
      const task = this.tasks.get(input.taskId);
      if (task) {
        this.requireTask(ownerId, input.taskId, true);
        if (!task.permissions.has('shell.execute')) {
          throw new BasicToolError('PERMISSION_DENIED', 'Shell output requires its source shell grant.');
        }
      }
      const offset = input.byteOffset ?? 0;
      if (offset > 0 && !input.expectedVersion) {
        throw new BasicToolError('VERSION_REQUIRED', 'Shell output continuation requires expectedVersion.');
      }
      if (this.activeReads >= 4) {
        throw new BasicToolError('RUNTIME_BUSY', 'The concurrent read limit was reached.');
      }
      this.activeReads++;
      let page: Awaited<ReturnType<ShellExecutor['readOutput']>>;
      const reading = this.shell.readOutput(
        ownerId,
        input.taskId,
        match[1]!,
        match[2] as 'stdout' | 'stderr',
        offset,
        Math.min(input.byteLimit ?? 36000, 36000)
      );
      this.outputReads.add(reading);
      try {
        page = await reading;
      } finally {
        this.activeReads--;
        this.outputReads.delete(reading);
      }
      if (input.expectedVersion !== undefined && input.expectedVersion !== page.version) {
        throw new BasicToolError('FILE_VERSION_CONFLICT', 'Shell output differs from the expected version.');
      }
      const end = offset + page.bytes.length;
      const truncated = end < page.totalBytes;
      return {
        encoding: 'base64',
        text: page.bytes.toString('base64'),
        version: page.version,
        totalBytes: page.totalBytes,
        byteOffset: offset,
        byteLength: page.bytes.length,
        truncated,
        next: truncated ? { byteOffset: end, expectedVersion: page.version } : null,
      };
    }
    const task = this.requireTask(ownerId, input.taskId);
    if (!task.permissions.has('files.read') && !task.permissions.has('files.write')) {
      throw new BasicToolError('PERMISSION_DENIED', 'This task has no file read permission.');
    }
    return this.enqueue(task, async () => {
      if (this.activeReads >= 4) {
        throw new BasicToolError('RUNTIME_BUSY', 'The concurrent file read limit was reached.');
      }
      this.activeReads++;
      try {
        const path = await resolveReadableFile(input.path, task.cwd);
        const snapshot = await readTextSnapshot(path);
        const continuation = (input.offset ?? 1) > 1 || (input.byteOffset ?? 0) > 0;
        let expected = input.expectedVersion;
        if (continuation && expected === undefined) {
          expected = task.observations.get(path.toLowerCase());
          if (expected === undefined) {
            throw new BasicToolError(
              'VERSION_REQUIRED',
              'Paging requires an earlier observation or expectedVersion.'
            );
          }
        }
        if (expected !== undefined && expected !== snapshot.version) {
          throw new BasicToolError(
            'FILE_VERSION_CONFLICT',
            'The file version differs from the expected version.'
          );
        }
        const result = pageText(snapshot, input);
        if (!task.observations.has(path.toLowerCase()) && task.observations.size >= 1024) {
          throw new BasicToolError('OBSERVATION_LIMIT', 'The task file observation limit was reached.');
        }
        task.observations.set(path.toLowerCase(), snapshot.version);
        return result;
      } catch (error) {
        if (error instanceof BasicToolError) {
          throw error;
        }
        throw new BasicToolError('FILE_READ_FAILED', 'The file could not be read.');
      } finally {
        this.activeReads--;
      }
    });
  }

  /**
   * Writes complete UTF-8 content under files.write, requiring an observation for existing files.
   */
  async write(ownerId: string, request: unknown): Promise<FileMutationResult> {
    const parsed = writeInputSchema.safeParse(request);
    if (!parsed.success) {
      throw new BasicToolError('INVALID_INPUT', 'The write request does not match the supported schema.');
    }
    return this.mutate(ownerId, { kind: 'write', input: parsed.data });
  }

  /**
   * Applies all exact edits to one original snapshot and publishes once; failures cannot partially edit the target.
   */
  async edit(ownerId: string, request: unknown): Promise<FileMutationResult> {
    const parsed = editInputSchema.safeParse(request);
    if (!parsed.success) {
      throw new BasicToolError('INVALID_INPUT', 'The edit request does not match the supported schema.');
    }
    return this.mutate(ownerId, { kind: 'edit', input: parsed.data });
  }

  /**
   * Runs shell.execute on the same task queue and operation-key namespace as file mutations.
   * Stop cancels the active Job independently of the queue; any admitted shell invalidates file observations.
   */
  async powershell(ownerId: string, request: unknown): Promise<ShellResult> {
    const parsed = shellInputSchema.safeParse(request);
    if (!parsed.success) {
      throw new BasicToolError('INVALID_INPUT', 'Invalid PowerShell input.');
    }
    const input = parsed.data;
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ kind: 'powershell', shell: 'windows-powershell-5.1', input }))
      .digest('hex');
    if (!this.tasks.has(input.taskId) && this.shell) {
      const historical = this.shell.lookup(ownerId, input.taskId, input.idempotencyKey, fingerprint);
      if (historical) {
        return historical;
      }
    }
    const task = this.requireTask(ownerId, input.taskId, true);
    if (!task.permissions.has('shell.execute')) {
      throw new BasicToolError('PERMISSION_DENIED', 'This task has no shell permission.');
    }
    if (!this.shell || !this.shell.status().available) {
      throw new BasicToolError('SHELL_UNAVAILABLE', 'The shell backend has not been assembled.');
    }
    const previous = task.operations.get(input.idempotencyKey);
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        throw new BasicToolError('IDEMPOTENCY_CONFLICT', 'The operation key has different input.');
      }
      return previous.pending.then((result) => structuredClone(result) as ShellResult);
    }
    this.requireActive(task);
    if (this.operationCount >= 1000) {
      throw new BasicToolError('TASK_OPERATION_LIMIT', 'The operation limit was reached.');
    }
    const pending = this.enqueue(task, async () => {
      const controller = new AbortController();
      task.shellAbort = controller;
      try {
        await resolveLocalDirectory(task.cwd);
        this.requireActive(task);
        return await this.shell!.run({
          ownerId,
          taskId: input.taskId,
          cwd: task.cwd,
          command: input.command,
          idempotencyKey: input.idempotencyKey,
          fingerprint,
          timeoutMs: input.timeout * 1000,
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof BasicToolError && error.code === 'SHELL_SUPERVISION_LOST') {
          task.state = 'isolated';
          task.isolation = { code: error.code, recoveryId: null };
        }
        throw error;
      } finally {
        task.shellAbort = null;
        task.observations.clear();
      }
    });
    task.operations.set(input.idempotencyKey, { fingerprint, pending });
    this.operationCount++;
    return pending.then((result) => structuredClone(result));
  }

  /**
   * Lists one authorized directory on the existing task queue with file-read authority.
   */
  async ls(ownerId: string, request: unknown): Promise<SearchResult> {
    const parsed = lsInputSchema.safeParse(request);
    if (!parsed.success) {
      throw new BasicToolError('INVALID_INPUT', 'Invalid ls input.');
    }
    return this.readonlySearch(ownerId, parsed.data.taskId, (scope) => this.search!.ls(parsed.data, scope));
  }

  /**
   * Finds authorized file paths without granting shell execution or file mutation observations.
   */
  async find(ownerId: string, request: unknown): Promise<SearchResult> {
    const parsed = findInputSchema.safeParse(request);
    if (!parsed.success) {
      throw new BasicToolError('INVALID_INPUT', 'Invalid find input.');
    }
    return this.readonlySearch(ownerId, parsed.data.taskId, (scope) => this.search!.find(parsed.data, scope));
  }

  /**
   * Searches finite native snapshots with the same task authority and stop admission as other Basic tools.
   */
  async grep(ownerId: string, request: unknown): Promise<SearchResult> {
    const parsed = grepInputSchema.safeParse(request);
    if (!parsed.success) {
      throw new BasicToolError('INVALID_INPUT', 'Invalid grep input.');
    }
    return this.readonlySearch(ownerId, parsed.data.taskId, (scope) => this.search!.grep(parsed.data, scope));
  }

  /**
   * Shares task ownership, permissions, queue and process cancellation; lost supervision isolates the task.
   */
  private readonlySearch(
    ownerId: string,
    taskId: string,
    run: (scope: { cwd: string; signal: AbortSignal }) => Promise<SearchResult>
  ): Promise<SearchResult> {
    const task = this.requireTask(ownerId, taskId);
    if (!task.permissions.has('files.read') && !task.permissions.has('files.write')) {
      throw new BasicToolError('PERMISSION_DENIED', 'Readonly search requires file read authority.');
    }
    if (!this.search) {
      throw new BasicToolError('SEARCH_UNAVAILABLE', 'The search backend has not been assembled.');
    }
    return this.enqueue(task, async () => {
      const controller = new AbortController();
      task.shellAbort = controller;
      try {
        return await run({ cwd: task.cwd, signal: controller.signal });
      } catch (error) {
        if (error instanceof BasicToolError && error.code === 'SEARCH_SUPERVISION_LOST') {
          task.state = 'isolated';
          task.isolation = { code: error.code, recoveryId: null };
        }
        throw error;
      } finally {
        task.shellAbort = null;
      }
    });
  }

  /**
   * Exposes only owner-bound lifecycle state, never execution paths or permissions to another connection.
   */
  taskStatus(
    ownerId: string,
    taskId: string
  ): { state: Task['state']; queued: number; isolation: Task['isolation'] } {
    const task = this.requireTask(ownerId, taskId, true);
    return {
      state: task.state,
      queued: task.queued,
      isolation: task.isolation ? { ...task.isolation } : null,
    };
  }

  /**
   * Preserves operation results after stopping, so a stopped or isolated task can retrieve the same mutation outcome.
   */
  private mutate(ownerId: string, mutation: Mutation): Promise<FileMutationResult> {
    const { input } = mutation;
    const task = this.requireTask(ownerId, input.taskId, true);
    if (!task.permissions.has('files.write')) {
      throw new BasicToolError('PERMISSION_DENIED', 'This task has no file write permission.');
    }
    const fingerprint = createHash('sha256').update(JSON.stringify(mutation)).digest('hex');
    const previous = task.operations.get(input.idempotencyKey);
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        throw new BasicToolError(
          'IDEMPOTENCY_CONFLICT',
          'The operation key was already used for different tool input.'
        );
      }
      return previous.pending.then((result) => structuredClone(result) as FileMutationResult);
    }
    this.requireActive(task);
    const bytes =
      mutation.kind === 'write'
        ? Buffer.byteLength(mutation.input.content)
        : mutation.input.edits.reduce(
            (total, edit) => total + Buffer.byteLength(edit.oldText) + Buffer.byteLength(edit.newText),
            0
          );
    if (this.operationCount >= 1000 || this.mutationBytes + bytes > 32 * 1024 * 1024) {
      throw new BasicToolError(
        'TASK_OPERATION_LIMIT',
        'The mutation operation or queued text limit was reached.'
      );
    }
    this.mutationBytes += bytes;
    let pending: Promise<FileMutationResult>;
    try {
      pending = this.enqueue(task, () => {
        const transaction = this.mutationTail.then(() => this.executeMutation(ownerId, task, mutation));
        this.mutationTail = transaction.then(
          () => {},
          () => {}
        );
        return transaction;
      });
    } catch (error) {
      this.mutationBytes -= bytes;
      throw error;
    }
    const settled = pending.finally(() => {
      this.mutationBytes -= bytes;
    });
    task.operations.set(input.idempotencyKey, { fingerprint, pending: settled });
    this.operationCount++;
    return settled.then((result) => structuredClone(result));
  }

  /**
   * Holds the product mutation coordinator across resolution, snapshot matching, edit preparation and actual commit.
   * Checks stop again before publication, then awaits the backend even if stop arrives after admission.
   */
  private async executeMutation(
    ownerId: string,
    task: Task,
    mutation: Mutation
  ): Promise<FileMutationResult> {
    this.requireActive(task);
    try {
      const { input } = mutation;
      const path = await resolveMutationFile(input.path, task.cwd);
      const observationKey = path.toLowerCase();
      if (!task.observations.has(observationKey) && task.observations.size >= 1024) {
        throw new BasicToolError('OBSERVATION_LIMIT', 'The task file observation limit was reached.');
      }
      let expected = input.expectedVersion ?? task.observations.get(observationKey);
      let content: Buffer;
      let diff: EditDiff | undefined;
      let replacements: number | undefined;
      if (mutation.kind === 'edit') {
        if (expected === undefined) {
          throw new BasicToolError(
            'EXPECTED_VERSION_REQUIRED',
            'Editing requires a prior observation or explicit expectedVersion.'
          );
        }
        const snapshot = await readTextSnapshot(path);
        if (snapshot.version !== expected) {
          throw new BasicToolError(
            'FILE_VERSION_CONFLICT',
            'The original file differs from the expected version.'
          );
        }
        const plan = prepareEdit(snapshot.bytes, mutation.input.edits);
        content = plan.content;
        replacements = plan.replacements;
        diff = describeEdit(snapshot.bytes, content);
      } else {
        content = Buffer.from(mutation.input.content, 'utf8');
        if (expected === undefined) {
          try {
            await lstat(path);
          } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
              expected = 'absent';
            } else {
              throw error;
            }
          }
          if (expected === undefined) {
            throw new BasicToolError(
              'EXPECTED_VERSION_REQUIRED',
              'Overwriting requires a prior observation or explicit expectedVersion.'
            );
          }
        }
      }
      this.requireActive(task);
      const outcome = await this.publication.publish({
        target: path,
        expectedVersion: expected,
        content,
        ownerId,
        taskId: input.taskId,
        idempotencyKey: input.idempotencyKey,
      });
      let fileEffect: FileMutationResult['fileEffect'] = 'not_applied';
      if (outcome.status === 'applied') {
        fileEffect = 'applied';
      }
      if (outcome.status === 'uncertain' || outcome.status === 'conflict_after_commit') {
        fileEffect = 'unknown';
        task.state = 'isolated';
        task.isolation = {
          code: outcome.status === 'uncertain' ? 'FILE_COMMIT_UNCERTAIN' : 'FILE_CONFLICT_AFTER_COMMIT',
          recoveryId: outcome.recoveryId,
        };
      }
      if ((outcome.status === 'applied' || outcome.status === 'no_change') && outcome.version) {
        task.observations.set(observationKey, outcome.version);
      }
      const result: FileMutationResult = { ...outcome, executionState: 'quiescent', fileEffect };
      if (outcome.status === 'applied' || outcome.status === 'no_change') {
        if (replacements !== undefined) {
          result.replacements = replacements;
          result.diff = diff;
        }
      }
      return result;
    } catch (error) {
      if (error instanceof BasicToolError) {
        if (error.code === 'FILE_RECOVERY_REQUIRED') {
          task.state = 'isolated';
          task.isolation = { code: error.code, recoveryId: null };
        }
        throw error;
      }
      throw new BasicToolError(
        'FILE_OPERATION_FAILED',
        'The file operation failed; inspect recovery before repeating it.'
      );
    }
  }

  /**
   * Serializes all calls of a task and holds queue ownership through actual completion, including rejected operations.
   */
  private enqueue<T>(task: Task, run: () => Promise<T>): Promise<T> {
    this.requireActive(task);
    if (task.queued >= 64) {
      throw new BasicToolError('TASK_QUEUE_FULL', 'The task call queue is full.');
    }
    task.queued++;
    const pending = task.tail.then(() => {
      this.requireActive(task);
      return run();
    });
    task.tail = pending.then(
      () => {
        task.queued--;
      },
      () => {
        task.queued--;
      }
    );
    return pending;
  }

  /**
   * Stops every task's admission, drains in-flight work, then closes the single publication backend.
   */
  async close(): Promise<void> {
    this.closing = true;
    for (const task of this.tasks.values()) {
      task.shellAbort?.abort();
      if (task.state === 'active') {
        task.state = 'stopping';
      }
    }
    await Promise.all([...this.tasks.values()].map((task) => task.tail));
    for (const task of this.tasks.values()) {
      task.observations.clear();
      if (task.state !== 'isolated') {
        task.state = 'stopped';
      }
    }
    await this.publication.close();
    await Promise.allSettled([...this.outputReads]);
    await this.shell?.close();
  }

  /**
   * Stops admission immediately and waits for an already-started read; queued reads reject before starting.
   * Removes observations only after the owned queue drains and retains operation outcomes for idempotent retrieval.
   */
  async stopTask(ownerId: string, taskId: string): Promise<void> {
    const task = this.requireTask(ownerId, taskId, true);
    task.shellAbort?.abort();
    if (task.state === 'active') {
      task.state = 'stopping';
    }
    await task.tail;
    task.observations.clear();
    if (task.state !== 'isolated') {
      task.state = 'stopped';
    }
  }

  /**
   * Hides whether another owner's task exists and rejects taskless or stopped requests.
   */
  private requireTask(ownerId: string, taskId: string, allowStopped = false): Task {
    const task = this.tasks.get(taskId);
    if (!task || task.ownerId !== ownerId) {
      throw new BasicToolError('TASK_NOT_FOUND', 'No task is authorized for this connection.');
    }
    if (task.state === 'registering') {
      throw new BasicToolError('TASK_NOT_READY', 'The Host task registration has not completed.');
    }
    if (!allowStopped) {
      this.requireActive(task);
    }
    return task;
  }

  /**
   * Blocks new work during stop or recovery isolation without affecting retrieval of an existing mutation result.
   */
  private requireActive(task: Task): void {
    if (task.state === 'isolated') {
      throw new BasicToolError('TASK_ISOLATED', 'This task requires recovery resolution.');
    }
    if (task.state !== 'active' || this.closing) {
      throw new BasicToolError('TASK_STOPPED', 'The task is no longer accepting calls.');
    }
  }
}
