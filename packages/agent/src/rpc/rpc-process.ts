/**
 * @author Codex
 * @description Dr.Octopus Pi RPC 子进程客户端，负责严格 JSONL、请求关联和进程生命周期
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { resolveOctopusCliPath } from '../cli/path.js';
import { JsonlDecoder } from './jsonl-decoder.js';
import { AgentRpcError } from './rpc-error.js';
import { drainBackgroundTasks } from './background-cleanup.js';
import { projectBackgroundTasks } from '@octopus/shared/protocol';
import type { BackgroundTasksSnapshot } from '@octopus/shared/protocol';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { WorkspaceDescriptor } from '../extensions/workspace/definitions/types.js';
import type {
  JsonAgentSessionEvent,
  RpcCommand,
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
  RpcResponse,
  RpcSessionState,
} from '@earendil-works/pi-coding-agent';

type RpcIncomingMessage = JsonAgentSessionEvent | RpcExtensionUIRequest | RpcResponse;
type RpcEventListener = (message: Exclude<RpcIncomingMessage, RpcResponse>) => void;

export type AgentRpcProcessState = 'idle' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';

export type AgentRpcProcessLifecycleEvent =
  | { type: 'ready'; pid: number | undefined }
  | { type: 'unexpected-exit'; error: AgentRpcError; code: number | null; signal: NodeJS.Signals | null }
  | { type: 'protocol-error'; error: AgentRpcError }
  | { type: 'stopped' };

type LifecycleListener = (event: AgentRpcProcessLifecycleEvent) => void;
export type RpcSuccessResponse = Extract<RpcResponse, { success: true }>;

interface PendingRequest {
  command: string;
  resolve: (response: RpcResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export interface AgentRpcProcessOptions {
  /**
   * Explicit Host-owned values merged into this child's environment copy only.
   */
  childEnvironment?: Readonly<Record<string, string>>;
  /**
   * Workspace Service 已解析并验证的 Workspace
   * 作用：
   *  - `workspace.id` 作为 Octopus CLI 的 Workspace selector
   *  - `workspace.cwd` 作为子进程唯一的启动工作目录
   *  - 避免调用方分别传入 Workspace 与 cwd 形成两个真相源
   */
  workspace: Pick<WorkspaceDescriptor, 'id' | 'cwd'>;
  /**
   * Canonical Pi Agent directory supplied by the Host path authority.
   */
  agentDir?: string;
  /**
   * Pi Session JSONL 路径
   * 作用：
   *  - 用于启动时恢复指定 Session
   *  - 省略时由 CLI 创建新 Session。
   */
  sessionPath?: string;
  /**
   * Exact ID for a newly created isolated Session; mutually exclusive with sessionPath.
   */
  sessionId?: string;
  /**
   * Explicit storage directory for isolated Session artifacts.
   */
  sessionDir?: string;
  /**
   * Octopus CLI package 入口路径
   * 省略时使用当前包解析出的生产入口。
   */
  cliPath?: string;
  /**
   * 覆盖生产 CLI 入口：仅供确定性的进程级测试使用。
   */
  entryPath?: string;
  /**
   * 单次 RPC 请求超时毫秒数；省略时使用客户端默认值。
   */
  requestTimeoutMs?: number;
  /**
   * 子进程 V8 old-space 上限 MiB；仅作用于生产 CLI 入口。
   */
  maxOldSpaceSizeMb?: number;
  /**
   * 单条 stdout JSONL 帧允许的最大字节数。
   */
  maxFrameBytes?: number;
  /**
   * 同一子进程允许等待响应的最大 RPC 请求数。
   */
  maxPendingRequests?: number;
  /**
   * 保留用于诊断的 stderr 尾部最大字节数。
   */
  maxStderrBytes?: number;
  /**
   * 停止运行中 Agent 时等待 `agent_settled` 的最长毫秒数。
   */
  settleTimeoutMs?: number;
  /**
   * 发送终止信号后等待子进程退出的最长毫秒数，超时后强杀。
   */
  stopTimeoutMs?: number;
}

/**
 * 表示一个 workspace 内独立运行的 Pi RPC Agent 进程。
 */
export class AgentRpcProcess {
  private readonly listeners = new Set<RpcEventListener>();
  private backgroundTasks?: BackgroundTasksSnapshot | null;
  private readonly lifecycleListeners = new Set<LifecycleListener>();
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private child: ChildProcessWithoutNullStreams | undefined;
  private terminatingChild: ChildProcessWithoutNullStreams | undefined;
  private state: AgentRpcProcessState = 'idle';
  private stderr = '';
  private terminalHandled = false;
  private writeTail: Promise<void> = Promise.resolve();
  private lastSessionState: RpcSessionState | undefined;
  private acceptingRequests = false;

  /**
   * @param options 工作区、进程和协议资源限制
   */
  public constructor(private readonly options: AgentRpcProcessOptions) {}

  /**
   * 启动子进程并通过 get_state 完成协议级就绪检查。
   */
  public async start(): Promise<void> {
    if (this.state !== 'idle' && this.state !== 'stopped' && this.state !== 'failed') {
      throw new AgentRpcError('PROCESS_START_FAILED', 'Agent RPC process is already started');
    }

    const env = this.buildChildEnvironment();
    this.state = 'starting';
    this.backgroundTasks = undefined;
    this.stderr = '';
    this.terminalHandled = false;
    this.acceptingRequests = true;
    const cliPath = this.options.entryPath ?? this.options.cliPath ?? resolveOctopusCliPath();
    const memoryLimit = this.options.maxOldSpaceSizeMb ?? 1024;
    if (this.options.sessionPath !== undefined && this.options.sessionId !== undefined) {
      throw new AgentRpcError('PROCESS_START_FAILED', 'Session path and Session id are mutually exclusive');
    }
    if (this.options.sessionDir !== undefined && !isAbsolute(this.options.sessionDir)) {
      throw new AgentRpcError('PROCESS_START_FAILED', 'Session directory must be an absolute path');
    }
    const rpcArgs = [
      '--mode',
      'rpc',
      '--workspace',
      this.options.workspace.id,
      ...(this.options.sessionPath === undefined ? [] : ['--session', this.options.sessionPath]),
      ...(this.options.sessionId === undefined ? [] : ['--session-id', this.options.sessionId]),
      ...(this.options.sessionDir === undefined ? [] : ['--session-dir', resolve(this.options.sessionDir)]),
    ];
    const args =
      this.options.entryPath === undefined
        ? [`--max-old-space-size=${memoryLimit}`, cliPath, ...rpcArgs]
        : [cliPath, ...rpcArgs];
    if (this.options.agentDir !== undefined) {
      if (!isAbsolute(this.options.agentDir)) {
        throw new AgentRpcError('PROCESS_START_FAILED', 'Agent directory must be an absolute path');
      }
      env.DR_OCTOPUS_CODING_AGENT_DIR = resolve(this.options.agentDir);
      // pi-subagents ≥0.65 detached runners resolve the agent directory through the
      // upstream PI_CODING_AGENT_DIR name (falling back to the package-default
      // ~/.dr-octopus/agent), so a custom agentDir must be mirrored there or runner
      // child sessions read the wrong models/auth configuration.
      env.PI_CODING_AGENT_DIR = env.DR_OCTOPUS_CODING_AGENT_DIR;
    }

    const child = spawn(process.execPath, args, {
      cwd: this.options.workspace.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;
    this.attachProcess(child);

    try {
      await this.execute({ type: 'get_state' });
      if (this.child !== child) {
        throw new AgentRpcError('PROCESS_EXITED', 'Agent RPC process exited during readiness check');
      }
      this.state = 'ready';
      this.emitLifecycle({ type: 'ready', pid: child.pid });
    } catch (error) {
      if (this.child === child) {
        await this.stop();
      }
      throw error instanceof AgentRpcError
        ? error
        : new AgentRpcError('PROCESS_START_FAILED', 'Agent RPC readiness check failed', { cause: error });
    }
  }

  /**
   * Copies the parent environment and validates Host overrides without changing global state.
   */
  private buildChildEnvironment(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    for (const [key, value] of Object.entries(this.options.childEnvironment ?? {})) {
      if (
        !/^[A-Z][A-Z0-9_]{0,127}$/.test(key) ||
        /^(NODE_|LD_|DYLD_|PATH$|PATHEXT$|COMSPEC$|SYSTEMROOT$|DR_OCTOPUS_CODING_AGENT_DIR$)/.test(key) ||
        typeof value !== 'string' ||
        value.includes('\0') ||
        value.length > 8192
      ) {
        throw new AgentRpcError('PROCESS_START_FAILED', 'Invalid child environment override.');
      }
      env[key] = value;
    }
    return env;
  }

  /**
   * 返回当前进程生命周期状态。
   */
  public getState(): AgentRpcProcessState {
    return this.state;
  }

  /**
   * 发送带唯一 ID 的 Pi RPC 命令并等待对应响应。
   *
   * @param command Pi RPC 命令
   * @returns 与命令 ID 关联的原始响应
   */
  public request(command: RpcCommand): Promise<RpcResponse> {
    return this.requestInternal(command, false);
  }

  /**
   * 发送 RPC 命令；关闭协调命令可以绕过业务请求闸门。
   *
   * @param command Pi RPC 命令
   * @param allowDuringShutdown 是否允许在关闭阶段发送
   * @returns 与命令 ID 关联的原始响应
   */
  private requestInternal(command: RpcCommand, allowDuringShutdown: boolean): Promise<RpcResponse> {
    if (!allowDuringShutdown && !this.acceptingRequests) {
      return Promise.reject(
        new AgentRpcError('PROCESS_NOT_READY', 'Agent RPC process is not accepting new requests')
      );
    }
    const child = this.requireWritableChild();
    const maxPending = this.options.maxPendingRequests ?? 256;
    if (this.pendingRequests.size >= maxPending) {
      return Promise.reject(
        new AgentRpcError(
          'RPC_CAPACITY_EXCEEDED',
          `Agent RPC pending request limit reached: ${String(maxPending)}`,
          { command: command.type, retryable: true }
        )
      );
    }

    const id = randomUUID();
    const timeoutMs = this.options.requestTimeoutMs ?? 30_000;
    return new Promise<RpcResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(
          new AgentRpcError('RPC_TIMEOUT', `Agent RPC request timed out: ${command.type}`, {
            command: command.type,
            retryable: command.type === 'get_state',
          })
        );
      }, timeoutMs);
      this.pendingRequests.set(id, { command: command.type, resolve, reject, timeout });
      this.enqueueWrite(child, `${JSON.stringify({ ...command, id })}\n`).catch((error: unknown) => {
        this.rejectRequest(
          id,
          new AgentRpcError('RPC_WRITE_FAILED', 'Agent RPC request write failed', {
            cause: error,
            command: command.type,
          })
        );
      });
    });
  }

  /**
   * 执行命令并把 Pi 的 success=false 响应转换为稳定异常。
   *
   * @param command Pi RPC 命令
   * @returns 成功响应；业务调用应优先使用本方法
   * @throws 当 Pi 拒绝命令或进程通信失败时抛出 AgentRpcError
   */
  public async execute(command: RpcCommand): Promise<RpcSuccessResponse> {
    return this.executeInternal(command, false);
  }

  /**
   * 执行并校验 RPC 响应，供正常调用和关闭协调共同复用。
   */
  private async executeInternal(
    command: RpcCommand,
    allowDuringShutdown: boolean
  ): Promise<RpcSuccessResponse> {
    const response = await this.requestInternal(command, allowDuringShutdown);
    if (!response.success) {
      throw new AgentRpcError('RPC_RESPONSE_ERROR', response.error, {
        command: response.command,
      });
    }
    return response;
  }

  /**
   * 回复扩展发起的 UI 请求，并在写入失败时显式拒绝。
   *
   * @param response 用户界面对扩展请求的响应
   */
  public async respondToExtensionUi(response: RpcExtensionUIResponse): Promise<void> {
    const child = this.requireWritableChild();
    await this.enqueueWrite(child, `${JSON.stringify(response)}\n`);
  }

  /**
   * 订阅 Agent 事件及扩展 UI 请求。
   *
   * @param listener 传输层事件消费者
   * @returns 取消订阅函数
   */
  public onEvent(listener: RpcEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 订阅进程生命周期事件。
   *
   * @param listener 生命周期消费者
   * @returns 取消订阅函数
   */
  public onLifecycle(listener: LifecycleListener): () => void {
    this.lifecycleListeners.add(listener);
    return () => this.lifecycleListeners.delete(listener);
  }

  /**
   * 返回有界的最近 stderr，供诊断和崩溃报告使用。
   */
  public getStderr(): string {
    return this.stderr;
  }

  /**
   * 返回最近一次 get_state 得到的会话恢复快照。
   */
  public getLastSessionState(): RpcSessionState | undefined {
    return this.lastSessionState;
  }

  /**
   * 有序停止 Agent；超时后强制终止。
   */
  public async stop(): Promise<void> {
    const child = this.child;
    if (child === undefined) {
      const terminatingChild = this.terminatingChild;
      if (terminatingChild !== undefined) {
        await this.waitForExit(terminatingChild);
      }
      if (this.state !== 'failed') {
        this.state = 'stopped';
      }
      return;
    }

    this.acceptingRequests = false;
    if (this.state === 'ready') {
      await this.abortActiveSession(child).catch(() => undefined);
      await drainBackgroundTasks(
        (command) => this.executeInternal(command, true),
        () => this.backgroundTasks
      );
    }
    this.state = 'stopping';
    this.child = undefined;
    child.kill('SIGTERM');
    await this.waitForExit(child);
    this.state = 'stopped';
    this.rejectAll(new AgentRpcError('PROCESS_EXITED', 'Agent RPC process stopped'));
    this.emitLifecycle({ type: 'stopped' });
  }

  /**
   * 查询活动状态，并在需要时发送 abort 后等待权威 agent_settled 事件。
   *
   * @param child 正在关闭的当前进程
   */
  private async abortActiveSession(child: ChildProcessWithoutNullStreams): Promise<void> {
    const response = await this.executeInternal({ type: 'get_state' }, true);
    if (response.command !== 'get_state') {
      return;
    }
    const state = response.data;
    if (!state.isStreaming && !state.isCompacting && state.pendingMessageCount === 0) {
      return;
    }

    const settled = this.waitForSettledEvent(child, this.options.settleTimeoutMs ?? 5_000);
    try {
      await this.executeInternal({ type: 'abort' }, true);
      await settled.promise;
    } finally {
      settled.cancel();
    }
  }

  /**
   * 在发送 abort 前建立 seek-safe 的 settled 等待器，避免遗漏快速事件。
   */
  private waitForSettledEvent(
    child: ChildProcessWithoutNullStreams,
    timeoutMs: number
  ): { promise: Promise<void>; cancel: () => void } {
    let cancel = (): void => undefined;
    const promise = new Promise<void>((resolve, reject) => {
      const eventListener: RpcEventListener = (event) => {
        if (event.type === 'agent_settled') {
          cleanup();
          resolve();
        }
      };
      const lifecycleListener: LifecycleListener = (event) => {
        if (event.type === 'unexpected-exit') {
          cleanup();
          reject(event.error);
        }
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(
          new AgentRpcError('RPC_TIMEOUT', 'Timed out waiting for agent_settled', {
            command: 'abort',
          })
        );
      }, timeoutMs);
      const cleanup = (): void => {
        clearTimeout(timeout);
        this.listeners.delete(eventListener);
        this.lifecycleListeners.delete(lifecycleListener);
      };
      cancel = cleanup;
      this.listeners.add(eventListener);
      this.lifecycleListeners.add(lifecycleListener);
      if (this.child !== child) {
        cleanup();
        reject(new AgentRpcError('PROCESS_EXITED', 'Agent RPC process exited before settling'));
      }
    });
    return { promise, cancel };
  }

  /**
   * 绑定 stdout、stderr 和退出事件。
   *
   * @param child 本实例拥有的子进程
   */
  private attachProcess(child: ChildProcessWithoutNullStreams): void {
    const decoder = new JsonlDecoder(this.options.maxFrameBytes ?? 8 * 1024 * 1024);
    child.stdout.on('data', (chunk: Buffer) => {
      try {
        for (const line of decoder.push(chunk)) {
          this.handleLine(child, line);
        }
      } catch (error) {
        this.handleProtocolError(child, error);
      }
    });
    child.stdout.once('end', () => {
      try {
        if (decoder.finish().length > 0 && this.child === child) {
          this.handleProtocolError(child, new Error('Agent RPC stdout ended with an incomplete JSONL frame'));
        }
      } catch (error) {
        this.handleProtocolError(child, error);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => this.appendStderr(chunk));
    child.stdin.once('error', (error) => {
      if (this.child === child) {
        this.failProcess(child, new AgentRpcError('RPC_WRITE_FAILED', error.message, { cause: error }));
      }
    });
    child.once('error', (error) => {
      this.handleExit(
        child,
        null,
        null,
        new AgentRpcError('PROCESS_START_FAILED', `Agent RPC process error: ${error.message}`, {
          cause: error,
          retryable: true,
        })
      );
    });
    child.once('close', (code, signal) => {
      if (this.terminatingChild === child) {
        this.terminatingChild = undefined;
      }
      this.handleExit(
        child,
        code,
        signal,
        new AgentRpcError(
          'PROCESS_EXITED',
          `Agent RPC process exited (code=${String(code)}, signal=${String(signal)})`,
          { retryable: true }
        )
      );
    });
  }

  /**
   * 解析并路由一条完整协议消息。
   *
   * @param child 消息所属进程，用于隔离迟到输出
   * @param line 完整 JSON 行
   */
  private handleLine(child: ChildProcessWithoutNullStreams, line: string): void {
    if (this.child !== child || line.length === 0) {
      return;
    }
    let message: RpcIncomingMessage;
    try {
      message = JSON.parse(line) as RpcIncomingMessage;
    } catch (error) {
      this.handleProtocolError(child, error);
      return;
    }
    if (message.type === 'response' && message.id !== undefined) {
      const pending = this.pendingRequests.get(message.id);
      if (pending !== undefined) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(message.id);
        if (message.success && message.command === 'get_state') {
          this.lastSessionState = message.data;
        }
        pending.resolve(message);
      }
      return;
    }
    if (message.type !== 'response') {
      const background = projectBackgroundTasks(message);
      if (background !== undefined) {
        this.backgroundTasks = background;
      }
      for (const listener of this.listeners) {
        listener(message);
      }
    }
  }

  /**
   * 将协议错误升级为进程故障，避免继续信任损坏的共享输出流。
   *
   * @param child 发生错误的进程
   * @param cause 解码或解析错误
   */
  private handleProtocolError(child: ChildProcessWithoutNullStreams, cause: unknown): void {
    if (this.child !== child) {
      return;
    }
    const error = new AgentRpcError('RPC_PROTOCOL_ERROR', 'Agent RPC stdout protocol error', { cause });
    this.emitLifecycle({ type: 'protocol-error', error });
    this.failProcess(child, error);
  }

  /**
   * 处理当前实例的终止，且确保 error/close 只结算一次。
   */
  private handleExit(
    child: ChildProcessWithoutNullStreams,
    code: number | null,
    signal: NodeJS.Signals | null,
    error: AgentRpcError
  ): void {
    if (this.child !== child || this.terminalHandled) {
      return;
    }
    this.terminalHandled = true;
    this.child = undefined;
    if (child.exitCode === null && child.signalCode === null) {
      this.terminatingChild = child;
    }
    this.state = 'failed';
    const enriched = new AgentRpcError(error.code, `${error.message}. ${this.stderr}`.trim(), {
      cause: error,
      retryable: error.retryable,
    });
    this.rejectAll(enriched);
    this.emitLifecycle({ type: 'unexpected-exit', error: enriched, code, signal });
  }

  /**
   * 主动终止协议状态不可信的当前进程。
   */
  private failProcess(child: ChildProcessWithoutNullStreams, error: AgentRpcError): void {
    if (this.child !== child) {
      return;
    }
    child.kill('SIGTERM');
    this.handleExit(child, child.exitCode, child.signalCode, error);
  }

  /**
   * 等待 OS 回收子进程；宽限期结束后强制终止。
   */
  private async waitForExit(child: ChildProcessWithoutNullStreams): Promise<void> {
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
      }, this.options.stopTimeoutMs ?? 3_000);
      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  /**
   * 对 stdin 写操作排序，并把底层错误传回调用者。
   */
  private enqueueWrite(child: ChildProcessWithoutNullStreams, line: string): Promise<void> {
    const write = this.writeTail.then(async () => {
      if (this.child !== child) {
        throw new AgentRpcError('PROCESS_EXITED', 'Agent RPC process exited before write');
      }
      await new Promise<void>((resolve, reject) => {
        child.stdin.write(line, (error) =>
          error === null || error === undefined ? resolve() : reject(error)
        );
      });
    });
    this.writeTail = write.catch(() => undefined);
    return write;
  }

  /**
   * 获取可写进程；starting 状态允许 readiness 请求。
   */
  private requireWritableChild(): ChildProcessWithoutNullStreams {
    if (this.child === undefined || (this.state !== 'starting' && this.state !== 'ready')) {
      throw new AgentRpcError('PROCESS_NOT_READY', 'Agent RPC process is not ready', { retryable: true });
    }
    return this.child;
  }

  /**
   * 仅保留 stderr 尾部，避免异常日志无限占用内存。
   */
  private appendStderr(chunk: Buffer): void {
    const maxBytes = this.options.maxStderrBytes ?? 256 * 1024;
    this.stderr += chunk.toString('utf8');
    while (Buffer.byteLength(this.stderr, 'utf8') > maxBytes) {
      this.stderr = this.stderr.slice(Math.max(1, Math.floor(this.stderr.length / 4)));
    }
  }

  /**
   * 拒绝指定请求并清理超时器。
   */
  private rejectRequest(id: string, error: Error): void {
    const pending = this.pendingRequests.get(id);
    if (pending === undefined) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(id);
    pending.reject(error);
  }

  /**
   * 在进程终止或协议损坏时拒绝全部悬挂请求。
   */
  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(id);
      pending.reject(error);
    }
  }

  /**
   * 向生命周期订阅者同步发布不可变事件。
   */
  private emitLifecycle(event: AgentRpcProcessLifecycleEvent): void {
    for (const listener of this.lifecycleListeners) {
      listener(event);
    }
  }
}
