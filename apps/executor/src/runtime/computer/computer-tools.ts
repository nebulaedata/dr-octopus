/**
 * @author Codex
 * @description Serializes task-owned upstream desktop calls, validates finite content and retires control on takeover or unknown execution.
 */
import { validateComputerContent, type ComputerResult } from './computer-results';
import { reportComputerFailure } from './computer-diagnostics';
import { BasicToolError } from '../basic/basic-inputs';
import {
  computerSchemas,
  computerDefinitions,
  computerCleanupReserveMs,
  computerExecutionDeadline,
  controlStatusSchema,
  upstreamArguments,
  type ComputerName,
} from './computer-inputs';
import type { ComputerUseActivity } from './computer-use-activity';
import type { WindowsMcpConnection } from './windows-mcp-connection';
export class ComputerTools {
  private busy = false;
  private revision = 0;
  private restarting: Promise<void> | undefined;
  private closed = false;
  private stopped = false;
  private taskId: string | undefined;
  private removeListener: (() => void) | undefined;
  private settled: Promise<void> = Promise.resolve();
  private closing: Promise<void> | undefined;
  private retiring: Promise<void> | undefined;
  /**
   * Shares product task feedback while upstream owns actual visible-control and input protection.
   */
  constructor(
    private readonly activity: ComputerUseActivity,
    private connection?: WindowsMcpConnection,
    private readonly reconnect?: () => Promise<WindowsMcpConnection>
  ) {
    if (connection) {
      this.listen(connection);
    }
  }
  /**
   * Attaches a single already-negotiated provider; replacement requires a fresh owner.
   */
  attach(connection: WindowsMcpConnection): void {
    if (this.closed || this.connection || !connection.isConnected()) {
      throw new Error('COMPUTER_CONNECTION_REJECTED');
    }
    this.connection = connection;
    this.listen(connection);
  }
  /**
   * Stops this provider after user takeover during an admitted task; subsequent calls cannot silently reacquire control.
   */
  private listen(connection: WindowsMcpConnection): void {
    this.removeListener = connection.onControl((status) => {
      if (this.taskId && ['user', 'takeover_pending', 'unavailable'].includes(status.state)) {
        void this.close().catch(() => {});
      }
    });
  }
  /**
   * Reopens only after an explicit new task request, confirmed cleanup and retirement of the prior task.
   */
  restart(): Promise<void> {
    if (this.available()) {
      return Promise.resolve();
    }
    this.restarting ??= this.reopen().finally(() => {
      this.restarting = undefined;
    });
    return this.restarting;
  }
  /**
   * Publishes a new connection only if no stop raced with its initialization.
   */
  private async reopen(): Promise<void> {
    if (!this.reconnect || this.taskId || this.busy) {
      throw new BasicToolError('COMPUTER_UNAVAILABLE', 'Stop the previous desktop task before restarting.');
    }
    await this.close();
    const revision = this.revision;
    const connection = await this.reconnect();
    if (revision !== this.revision) {
      await connection.close();
      throw new BasicToolError('COMPUTER_UNAVAILABLE', 'Desktop restart was stopped.');
    }
    this.connection = undefined;
    this.closed = false;
    this.stopped = false;
    this.closing = undefined;
    this.retiring = undefined;
    this.attach(connection);
  }
  /**
   * Projects actual connection metadata without initiating a desktop call.
   */
  backendStatus(): ReturnType<WindowsMcpConnection['readStatus']> | null {
    return this.connection?.readStatus() ?? null;
  }
  /**
   * Reports only current negotiated availability.
   */
  available(): boolean {
    return !this.closed && (this.connection?.isConnected() ?? false);
  }
  /**
   * Exposes shutdown evidence for task recovery, never merely transport availability.
   */
  executionStopped(): boolean {
    return this.stopped && !this.busy;
  }
  /**
   * Binds one globally admitted task; upstream handles visual acquisition for each call.
   */
  startTask(taskId: string): void {
    this.taskId = taskId;
    this.activity.startTask(taskId);
  }
  /**
   * Retires product feedback; the Runtime closes upstream ownership at task completion.
   */
  release(taskId: string): void {
    if (this.taskId === taskId) {
      this.taskId = undefined;
    }
    this.activity.endTask(taskId);
  }
  /**
   * Executes one finite action; every upstream call except status can acquire desktop control, including screenshots.
   */
  async call(
    taskId: string,
    name: ComputerName,
    input: unknown,
    options?: { deadlineMs: number }
  ): Promise<ComputerResult> {
    const startedAt = Date.now();
    const request = computerSchemas[name].parse(input);
    if (request.taskId !== taskId || this.taskId !== taskId) {
      throw new BasicToolError('TASK_NOT_FOUND', 'Desktop task is not active.');
    }
    if (!this.available()) {
      throw new BasicToolError('COMPUTER_UNAVAILABLE', 'Desktop control is unavailable.');
    }
    if (this.busy) {
      throw new BasicToolError('ACTION_IN_PROGRESS', 'A desktop operation is still running.');
    }
    const policy = computerDefinitions[name];
    const deadline = computerExecutionDeadline(
      name,
      options?.deadlineMs ?? Date.now() + policy.timeoutMs + computerCleanupReserveMs
    );
    const args = upstreamArguments(name, request);
    this.busy = true;
    let settle!: () => void;
    this.settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    let feedback: ReturnType<ComputerUseActivity['begin']> | undefined;
    let dispatched = false;
    try {
      feedback = this.activity.begin();
      const connection = this.connection!;
      const stateResult = await connection.callTool(
        'ControlStatus',
        {},
        {
          timeoutMs: Math.min(
            computerDefinitions['computer.control.status'].timeoutMs,
            deadline - Date.now()
          ),
        }
      );
      const state = controlStatusSchema.parse(stateResult.structuredContent);
      if (name === 'computer.control.status') {
        return { control: state, backend: connection.readStatus() };
      }
      if (!['ready', 'ai'].includes(state.state)) {
        throw new BasicToolError(
          'COMPUTER_USER_CONTROL',
          'The user owns desktop control; no action was dispatched.'
        );
      }
      if (this.closed) {
        throw new BasicToolError('COMPUTER_UNAVAILABLE', 'Desktop control stopped before dispatch.');
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs < policy.minimumMs) {
        throw new BasicToolError(
          'COMPUTER_BUDGET_INSUFFICIENT',
          'Desktop preflight consumed the remaining execution budget. No action was dispatched.'
        );
      }
      dispatched = true;
      const result = await connection.callTool(policy.upstream, args, { timeoutMs: remainingMs });
      const blocks = validateComputerContent(result.content);
      // Upstream some tools return an error as ordinary text rather than isError.
      const failed =
        result.isError === true ||
        blocks.some((block) => block.type === 'text' && /^(Error\b|Failed\b)/i.test(block.text.trim()));
      if (failed) {
        if (policy.mutation) {
          throw new Error('Upstream action failed after dispatch');
        }
        throw new BasicToolError('COMPUTER_EXECUTION_FAILED', 'Upstream desktop observation failed.');
      }
      if (
        (name === 'computer.screenshot' ||
          (name === 'computer.snapshot' && 'image' in request && request.image)) &&
        !blocks.some((block) => block.type === 'image')
      ) {
        throw new Error('Missing screenshot image');
      }
      if (this.closed) {
        throw new Error('Control retired during operation');
      }
      return {
        computerContent: blocks,
        backend: connection.readStatus(),
        businessEffect: policy.mutation ? 'applied' : 'not_applied',
        resultMeaning: policy.mutation
          ? 'Upstream reported completion; verify the application state before claiming business success.'
          : 'Observation completed.',
        code: 'OK',
      };
    } catch (error) {
      if (dispatched && !(error instanceof BasicToolError)) {
        feedback?.uncertain();
        try {
          await this.retireConnection();
        } catch {
          /* Cleanup failure keeps admission closed. */
        }
        reportComputerFailure({
          stage: 'dispatch',
          tool: name,
          code: policy.mutation ? 'COMPUTER_RESULT_UNKNOWN' : 'COMPUTER_OBSERVATION_INTERRUPTED',
          durationMs: Date.now() - startedAt,
          cleanupConfirmed: this.stopped,
        });
        throw new BasicToolError(
          policy.mutation ? 'COMPUTER_RESULT_UNKNOWN' : 'COMPUTER_OBSERVATION_INTERRUPTED',
          policy.mutation
            ? 'The dispatched input outcome is unknown. Do not replay; stop the task before starting another.'
            : 'The observation did not complete and desktop control was retired. No input action was requested; stop the task before starting another.'
        );
      }
      if (error instanceof BasicToolError) {
        reportComputerFailure({
          stage: dispatched ? 'dispatch' : 'preflight',
          tool: name,
          code: error.code,
          durationMs: Date.now() - startedAt,
        });
        throw error;
      }
      reportComputerFailure({
        stage: 'preflight',
        tool: name,
        code: 'COMPUTER_UNAVAILABLE',
        durationMs: Date.now() - startedAt,
      });
      throw new BasicToolError('COMPUTER_UNAVAILABLE', 'The upstream desktop state could not be obtained.');
    } finally {
      this.busy = false;
      settle();
      if (!this.closed || this.stopped) {
        feedback?.complete();
      }
      if (this.stopped) {
        this.activity.endTasks();
      }
    }
  }
  /**
   * Closes the owned Job and drains the running call before reporting execution stopped.
   */
  close(): Promise<void> {
    this.revision++;
    this.closed = true;
    this.closing ??= Promise.resolve().then(async () => {
      await this.retireConnection();
      await this.settled;
      this.activity.endTasks();
    });
    return this.closing;
  }
  /**
   * Retires one connection once, independently of call draining so an in-flight error cannot wait on itself.
   */
  private retireConnection(): Promise<void> {
    this.closed = true;
    this.retiring ??= Promise.resolve().then(async () => {
      const startedAt = Date.now();
      try {
        const result = await this.connection?.close();
        this.stopped = result?.executionStopConfirmed ?? true;
      } catch (error) {
        reportComputerFailure({
          stage: 'cleanup',
          code: 'WINDOWS_MCP_CLEANUP_UNCONFIRMED',
          durationMs: Date.now() - startedAt,
          cleanupConfirmed: false,
        });
        throw error;
      } finally {
        this.removeListener?.();
        this.removeListener = undefined;
      }
    });
    return this.retiring;
  }
}
