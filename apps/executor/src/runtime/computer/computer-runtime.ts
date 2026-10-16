/**
 * @author Codex
 * @description Assembles one guarded Computer backend and existing activity/tools under Runtime ownership, with authoritative startup and connection status.
 */
import type { ComputerRuntimeStatus } from '../../contracts/computer-use';
import type { ComputerBackend } from './computer-backend';
import { ComputerTools } from './computer-tools';
import type { ComputerUseActivity } from './computer-use-activity';

export class ComputerRuntime {
  readonly tools: ComputerTools;
  private starting: Promise<void> | undefined;
  private stopping: Promise<void> | undefined;
  private state: ComputerRuntimeStatus['state'] = 'stopped';
  private stopFailed = false;

  /**
   * Owns the fixed local backend; initialization cannot be redirected by Renderer or MCP settings.
   */
  constructor(
    private readonly activity: ComputerUseActivity,
    private readonly backend: ComputerBackend
  ) {
    this.tools = new ComputerTools(activity);
  }

  /**
   * Coalesces optional startup independently of Basic/Browser readiness; failures leave Computer unavailable without retry.
   */
  start(): Promise<void> {
    if (this.stopping) {
      return Promise.resolve();
    }
    this.starting ??= this.initialize();
    return this.starting;
  }

  /**
   * Returns credential-free owner state; tool readiness also requires a currently negotiated connection.
   */
  status(): ComputerRuntimeStatus {
    const available = this.tools.available();
    const state = this.state === 'ready' && !available ? 'unavailable' : this.state;
    const reasons: Record<ComputerRuntimeStatus['state'], string> = {
      stopped: '桌面后端尚未启动',
      starting: '桌面后端正在启动并验证连接',
      ready: '桌面工具已就绪，使用前需显式授权',
      failed: '桌面后端启动或握手失败，请完整重启执行器后重试',
      unavailable: '桌面连接已断开或任务结果待确认，当前不可执行桌面操作',
      stopping: '正在停止桌面控制并确认后台退出',
      closed: '桌面控制已停止，请重启执行器重新启用',
    };
    return {
      state,
      available,
      reason: this.stopFailed ? '桌面后台停止未获确认，请从托盘完整退出执行器' : reasons[state],
    };
  }

  /**
   * Attaches only after actual handshake; shutdown winning the race never publishes a late ready connection.
   */
  private async initialize(): Promise<void> {
    this.state = 'starting';
    try {
      const connection = await this.backend.connect();
      if (this.stopping) {
        return;
      }
      this.tools.attach(connection);
      this.state = 'ready';
    } catch {
      if (!this.stopping) {
        this.state = 'failed';
      }
      // Connection startup owns its failed transport cleanup; final owner close still confirms it.
    }
  }

  /**
   * Cancels any pending handshake immediately and confirms only this backend's process-tree cleanup.
   */
  close(): Promise<void> {
    this.stopping ??= this.shutdown();
    return this.stopping;
  }

  /**
   * Drains startup and tools even when backend cleanup fails; unconfirmed shutdown remains a rejection.
   */
  private async shutdown(): Promise<void> {
    this.state = 'stopping';
    // TaskAuthority may release its task while the Job owner is still stopping.
    // Keep one independent cleanup signal until actual backend exit, including an idle input gap.
    const feedback = this.activity.snapshot().state === 'idle' ? undefined : this.activity.begin();
    try {
      const results = await Promise.allSettled([this.backend.close(), this.tools.close()]);
      await this.starting;
      for (const result of results) {
        if (result.status === 'rejected') {
          throw result.reason;
        }
      }
      const backend = results[0];
      if (backend.status === 'fulfilled' && !backend.value?.executionStopConfirmed) {
        throw new Error('COMPUTER_BACKEND_STOP_UNCONFIRMED');
      }
      this.state = 'closed';
      feedback?.complete();
    } catch (error) {
      this.state = 'failed';
      this.stopFailed = true;
      feedback?.uncertain();
      throw error;
    }
  }
}
