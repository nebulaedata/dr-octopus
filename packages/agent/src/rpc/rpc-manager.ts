/**
 * @author Codex
 * @description 管理 Dr.Octopus Pi RPC 子进程的业务生命周期、重启退避与熔断
 */

import { AgentRpcError } from './rpc-error.js';
import { AgentRpcProcess } from './rpc-process.js';
import type { AgentRpcProcessLifecycleEvent, AgentRpcProcessOptions } from './rpc-process.js';

export interface AgentProcessRestartPolicy {
  mode?: 'on-demand' | 'eager';
  maxRestarts?: number;
  windowMs?: number;
  backoffMs?: readonly number[];
  jitterRatio?: number;
}

export interface AgentProcessManagerOptions {
  restartPolicy?: AgentProcessRestartPolicy;
}

export type ManagedAgentHealth = 'starting' | 'healthy' | 'recovering' | 'unavailable' | 'circuit-open';

export interface ManagedAgentSnapshot {
  runtimeId: string;
  health: ManagedAgentHealth;
  restartCount: number;
  lastFailure?: string;
}

interface ManagedAgentRecord {
  stopping?: boolean;
  stopPromise?: Promise<void>;
  runtimeId: string;
  generation: number;
  options: AgentRpcProcessOptions;
  process: AgentRpcProcess | undefined;
  startPromise: Promise<AgentRpcProcess> | undefined;
  restartHistory: number[];
  lastFailure: AgentRpcError | undefined;
  circuitOpen: boolean;
  restartTimer: NodeJS.Timeout | undefined;
}

const DEFAULT_BACKOFF_MS = [250, 1_000, 4_000] as const;

/**
 * 按 runtimeId 维护一个 Agent 实例对应一个 RPC 子进程，并协调故障恢复。
 */
export class AgentProcessManager {
  private readonly records = new Map<string, ManagedAgentRecord>();
  private readonly policy: Required<AgentProcessRestartPolicy>;
  private shuttingDown = false;

  /**
   * @param options 重启、退避和熔断策略
   */
  public constructor(options: AgentProcessManagerOptions = {}) {
    const policy = options.restartPolicy ?? {};
    this.policy = {
      mode: policy.mode ?? 'on-demand',
      maxRestarts: policy.maxRestarts ?? 3,
      windowMs: policy.windowMs ?? 60_000,
      backoffMs: policy.backoffMs ?? DEFAULT_BACKOFF_MS,
      jitterRatio: policy.jitterRatio ?? 0.2,
    };
  }

  /**
   * 注册并启动一个新业务 Agent；已注册的 runtimeId 必须改用 ensureReady。
   *
   * @param runtimeId Host 分配的逻辑 runtime 身份
   * @param options 子进程配置
   * @returns 已通过协议就绪检查的 Agent 进程
   */
  public async start(runtimeId: string, options: AgentRpcProcessOptions): Promise<AgentRpcProcess> {
    this.assertRunning();
    if (this.records.has(runtimeId)) {
      throw new AgentRpcError('PROCESS_START_FAILED', `Agent process already exists: ${runtimeId}`);
    }
    const record: ManagedAgentRecord = {
      runtimeId,
      generation: 0,
      options,
      process: undefined,
      startPromise: undefined,
      restartHistory: [],
      lastFailure: undefined,
      circuitOpen: false,
      restartTimer: undefined,
    };
    this.records.set(runtimeId, record);
    try {
      return await this.launch(record, false);
    } catch (error) {
      this.records.delete(runtimeId);
      throw error;
    }
  }

  /**
   * 返回健康实例，或在故障后以 single-flight 方式按需重建。
   *
   * @param runtimeId 已注册的逻辑 runtime 身份
   * @param options runtimeId 尚未注册时使用的进程配置
   * @returns 唯一的 ready 进程
   */
  public async ensureReady(runtimeId: string, options?: AgentRpcProcessOptions): Promise<AgentRpcProcess> {
    this.assertRunning();
    let record = this.records.get(runtimeId);
    if (record === undefined) {
      if (options === undefined) {
        throw new AgentRpcError('PROCESS_NOT_READY', `Agent process is not registered: ${runtimeId}`);
      }
      record = {
        runtimeId,
        generation: 0,
        options,
        process: undefined,
        startPromise: undefined,
        restartHistory: [],
        lastFailure: undefined,
        circuitOpen: false,
        restartTimer: undefined,
      };
      this.records.set(runtimeId, record);
    }
    if (record.stopping) {
      throw new AgentRpcError('PROCESS_NOT_READY', 'Agent cleanup is not confirmed; retry stopping it.');
    }
    if (record.circuitOpen) {
      throw new AgentRpcError('RESTART_CIRCUIT_OPEN', `Agent restart circuit is open: ${runtimeId}`);
    }
    if (record.process?.getState() === 'ready') {
      return record.process;
    }
    if (record.startPromise !== undefined) {
      return record.startPromise;
    }
    return this.launch(record, record.lastFailure !== undefined);
  }

  /**
   * 获取业务键对应的健康 Agent 进程。
   */
  public get(runtimeId: string): AgentRpcProcess | undefined {
    if (this.records.get(runtimeId)?.stopping) {
      return undefined;
    }
    const process = this.records.get(runtimeId)?.process;
    return process?.getState() === 'ready' ? process : undefined;
  }

  /**
   * 返回业务键的可观测健康快照。
   */
  public getHealth(runtimeId: string): ManagedAgentSnapshot | undefined {
    const record = this.records.get(runtimeId);
    if (record === undefined) {
      return undefined;
    }
    this.trimRestartHistory(record);
    return {
      runtimeId,
      health: this.resolveHealth(record),
      restartCount: record.restartHistory.length,
      ...(record.lastFailure === undefined ? {} : { lastFailure: record.lastFailure.message }),
    };
  }

  /**
   * 显式关闭熔断并重新启动指定业务 Agent。
   */
  public async restart(runtimeId: string): Promise<AgentRpcProcess> {
    this.assertRunning();
    const record = this.requireRecord(runtimeId);
    if (record.restartTimer !== undefined) {
      clearTimeout(record.restartTimer);
      record.restartTimer = undefined;
    }
    if (record.process !== undefined) {
      await record.process.stop();
      record.process = undefined;
    }
    record.circuitOpen = false;
    record.stopping = false;
    record.restartHistory = [];
    return this.launch(record, true);
  }

  /**
   * 停止并彻底注销一个 Agent 进程。
   */
  public async stop(runtimeId: string): Promise<void> {
    const record = this.records.get(runtimeId);
    if (record === undefined) {
      return;
    }
    if (record.stopPromise) {
      return record.stopPromise;
    }
    record.stopping = true;
    if (record.restartTimer !== undefined) {
      clearTimeout(record.restartTimer);
    }
    const process = record.process;
    const stopping = (async () => {
      if (process !== undefined) {
        await process.stop();
      }
      record.process = undefined;
      this.records.delete(runtimeId);
    })();
    record.stopPromise = stopping;
    try {
      await stopping;
    } finally {
      record.stopPromise = undefined;
    }
  }

  /**
   * 关闭 Manager 并停止所有进程，期间禁止任何进程复活。
   */
  public async stopAll(): Promise<void> {
    this.shuttingDown = true;
    const records = [...this.records.values()];
    for (const record of records) {
      if (record.restartTimer !== undefined) {
        clearTimeout(record.restartTimer);
      }
    }
    const results = await Promise.allSettled(records.map(async (record) => this.stop(record.runtimeId)));
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length) {
      throw new AggregateError(
        failures.map((failure) =>
          failure.reason instanceof Error ? failure.reason : new Error('Agent cleanup failed.')
        ),
        'Agent cleanup was not confirmed.'
      );
    }
  }

  /**
   * 创建进程、绑定身份安全的退出监听，并复用并发启动 Promise。
   */
  private launch(record: ManagedAgentRecord, isRestart: boolean): Promise<AgentRpcProcess> {
    if (record.startPromise !== undefined) {
      return record.startPromise;
    }
    if (isRestart) {
      this.registerRestartAttempt(record);
    }
    const process = new AgentRpcProcess(record.options);
    record.generation += 1;
    const generation = record.generation;
    record.process = process;
    process.onLifecycle((event) => this.handleLifecycle(record, process, generation, event));

    const startPromise = process
      .start()
      .then(() => {
        record.lastFailure = undefined;
        return process;
      })
      .catch((error: unknown) => {
        if (record.process === process) {
          record.process = undefined;
        }
        const failure =
          error instanceof AgentRpcError
            ? error
            : new AgentRpcError(
                'PROCESS_START_FAILED',
                `Agent process failed to start: ${record.runtimeId}`,
                {
                  cause: error,
                  retryable: true,
                }
              );
        record.lastFailure = failure;
        throw failure;
      })
      .finally(() => {
        if (record.startPromise === startPromise) {
          record.startPromise = undefined;
        }
      });
    record.startPromise = startPromise;
    return startPromise;
  }

  /**
   * 响应进程终止事件，并通过实例身份隔离旧进程的迟到事件。
   */
  private handleLifecycle(
    record: ManagedAgentRecord,
    process: AgentRpcProcess,
    generation: number,
    event: AgentRpcProcessLifecycleEvent
  ): void {
    if (event.type !== 'unexpected-exit' || record.process !== process || record.generation !== generation) {
      return;
    }
    record.process = undefined;
    record.lastFailure = event.error;
    if (this.shuttingDown || record.stopping || !this.records.has(record.runtimeId)) {
      return;
    }
    if (this.policy.mode === 'eager') {
      this.scheduleEagerRestart(record);
    }
  }

  /**
   * 安排带抖动的 eager 重启；连续失败由熔断限制。
   */
  private scheduleEagerRestart(record: ManagedAgentRecord): void {
    try {
      this.registerRestartAttempt(record);
    } catch {
      return;
    }
    const attempt = record.restartHistory.length;
    const index = Math.min(attempt - 1, this.policy.backoffMs.length - 1);
    const baseDelay = this.policy.backoffMs[index] ?? 0;
    const jitter = baseDelay * this.policy.jitterRatio * (Math.random() * 2 - 1);
    const delay = Math.max(0, Math.round(baseDelay + jitter));
    record.restartTimer = setTimeout(() => {
      record.restartTimer = undefined;
      if (this.shuttingDown || record.circuitOpen || !this.records.has(record.runtimeId)) {
        return;
      }
      this.launch(record, false).catch(() => {
        if (!record.circuitOpen) {
          this.scheduleEagerRestart(record);
        }
      });
    }, delay);
    record.restartTimer.unref();
  }

  /**
   * 记录一次恢复尝试并在窗口内超过阈值时打开熔断。
   */
  private registerRestartAttempt(record: ManagedAgentRecord): void {
    this.trimRestartHistory(record);
    if (record.restartHistory.length >= this.policy.maxRestarts) {
      record.circuitOpen = true;
      throw new AgentRpcError('RESTART_CIRCUIT_OPEN', `Agent restart circuit is open: ${record.runtimeId}`);
    }
    record.restartHistory.push(Date.now());
  }

  /**
   * 移除熔断统计窗口之外的启动记录。
   */
  private trimRestartHistory(record: ManagedAgentRecord): void {
    const threshold = Date.now() - this.policy.windowMs;
    record.restartHistory = record.restartHistory.filter((timestamp) => timestamp >= threshold);
  }

  /**
   * 将内部记录映射成稳定的业务健康状态。
   */
  private resolveHealth(record: ManagedAgentRecord): ManagedAgentHealth {
    if (record.stopping) {
      return 'unavailable';
    }
    if (record.circuitOpen) {
      return 'circuit-open';
    }
    if (record.startPromise !== undefined) {
      return record.lastFailure === undefined ? 'starting' : 'recovering';
    }
    if (record.process?.getState() === 'ready') {
      return 'healthy';
    }
    return 'unavailable';
  }

  /**
   * 在 shutdown gate 打开后阻止创建或恢复进程。
   */
  private assertRunning(): void {
    if (this.shuttingDown) {
      throw new AgentRpcError('MANAGER_SHUTTING_DOWN', 'Agent process manager is shutting down');
    }
  }

  /**
   * 获取已注册记录，缺失时返回稳定错误。
   */
  private requireRecord(runtimeId: string): ManagedAgentRecord {
    const record = this.records.get(runtimeId);
    if (record === undefined) {
      throw new AgentRpcError('PROCESS_NOT_READY', `Agent process is not registered: ${runtimeId}`);
    }
    return record;
  }
}
