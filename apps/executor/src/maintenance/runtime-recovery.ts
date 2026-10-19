/**
 * @author Codex
 * @description Coordinates explicit stopped-data backup and reset, retaining original trees and allowing only catalogued storage recovery.
 */
import { lstat, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RuntimeSnapshot } from '../contracts/runtime';
import type { MaintenanceSnapshot } from '../contracts/maintenance';
import type { NativeFileCommit } from '../runtime/basic/native-file-commit';
import { backupData } from './data-backup';
import { recoveryUnits } from './recovery-units';

type RuntimeLifecycle = {
  projectRoot: string;
  /**
   * Reads authoritative lifecycle and startup failure metadata without changing business data.
   */
  readStatus(): RuntimeSnapshot;
  /**
   * Confirms that the owned Runtime has exited before any maintenance write.
   */
  stop(): Promise<void>;
  /**
   * Resolves only after the new Runtime handshake has succeeded.
   */
  start(): Promise<void>;
};

export class RuntimeRecovery {
  private snapshot: MaintenanceSnapshot = { phase: 'idle', message: '', backupPath: null, issue: null };
  private busy = false;
  private closing = false;
  private settled: Promise<void> = Promise.resolve();

  /**
   * Injects only lifecycle operations and the private file backend, never business services.
   */
  constructor(
    private readonly runtime: RuntimeLifecycle,
    private readonly native: NativeFileCommit
  ) {}

  /**
   * Projects allowlisted failure metadata; no journal contents or credentials enter diagnostics.
   */
  read(): MaintenanceSnapshot {
    const result = structuredClone(this.snapshot);
    if (this.busy) {
      return result;
    }
    const status = this.runtime.readStatus();
    if (status.state === 'failed') {
      if (result.phase === 'succeeded') {
        result.phase = 'idle';
        result.message = '';
      }
      const code = status.startupFailure ?? 'RUNTIME_UNAVAILABLE';
      const unit = recoveryUnits.find((item) => item.code === code);
      result.issue = {
        revision: status.revision,
        code,
        title: unit?.title ?? '执行服务无法启动',
        description: unit?.description ?? status.message,
        impact: unit?.impact ?? null,
        recoverable: !!unit,
      };
    } else if (result.phase === 'failed' && result.issue) {
      result.issue.revision = status.revision;
    } else if (result.phase === 'idle') {
      result.issue = null;
    }
    return result;
  }

  /**
   * Reports serialization ownership to the Host so other lifecycle actions cannot race recovery.
   */
  isBusy(): boolean {
    return this.busy;
  }

  /**
   * Closes maintenance admission and waits for owned writes before application shutdown.
   */
  async close(): Promise<void> {
    this.closing = true;
    await this.settled;
  }

  /**
   * Clears only a completed success notice; it never hides an unresolved failure.
   */
  dismiss(): void {
    if (!this.busy && this.snapshot.phase === 'succeeded') {
      this.snapshot = { phase: 'idle', message: '', backupPath: null, issue: null };
    }
  }

  /**
   * Retries startup or backs up a catalogued group before retiring originals; partial effects and backups are retained.
   * @throws When admission is stale, concurrent or no longer refers to a failed Runtime.
   */
  async run(action: 'reset' | 'retry', revision: number): Promise<void> {
    const status = this.runtime.readStatus();
    if (
      this.closing ||
      this.busy ||
      !['failed', 'stopped'].includes(status.state) ||
      status.revision !== revision ||
      (status.state === 'stopped' && this.snapshot.phase !== 'failed')
    ) {
      throw new Error('服务状态已变化，请刷新后重试');
    }
    const unit = recoveryUnits.find((item) => item.code === this.read().issue?.code);
    if (action === 'reset' && !unit) {
      throw new Error('此故障不支持数据重置，请查看详情');
    }
    this.snapshot = { ...this.read(), phase: 'stopping', message: '正在停止执行服务…' };
    this.busy = true;
    let complete!: () => void;
    this.settled = new Promise<void>((resolve) => {
      complete = resolve;
    });
    let backupComplete = false;
    let resetStarted = false;
    try {
      await this.runtime.stop();
      if (action === 'reset' && unit) {
        this.snapshot.phase = 'backing-up';
        this.snapshot.message = '正在备份数据…';
        const root = join(this.runtime.projectRoot, '.octopus-executor-recovery-maintenance');
        const info = await this.native.inspect(root);
        if (!info.ok && info.nativeCode === 2) {
          const created = await this.native.createRecovery(root);
          if (!created.ok || !created.privateAcl) {
            throw new Error('PRIVATE_MAINTENANCE_DIRECTORY');
          }
        } else if (!info.ok || !info.directory || !info.privateAcl) {
          throw new Error('PRIVATE_MAINTENANCE_DIRECTORY');
        }
        const backup = join(root, '.octopus-executor-recovery-' + randomUUID());
        this.snapshot.backupPath = backup;
        await backupData(this.native, this.runtime.projectRoot, backup, [...unit.entries]);
        backupComplete = true;
        const retired = join(backup, '.octopus-executor-recovery-originals');
        const created = await this.native.createRecovery(retired);
        if (!created.ok || !created.privateAcl) {
          throw new Error('PRIVATE_RETIRED_DIRECTORY');
        }
        this.snapshot.phase = 'resetting';
        this.snapshot.message = '正在重置数据…';
        // No recursive deletion: complete backups and the exact original directories both remain available.
        for (const entry of unit.entries) {
          const source = join(this.runtime.projectRoot, entry);
          try {
            await lstat(source);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
              continue;
            }
            throw error;
          }
          const inspected = await this.native.inspect(source);
          if (!inspected.ok || !inspected.directory || !inspected.privateAcl) {
            throw new Error('RECOVERY_SOURCE_CHANGED');
          }
          resetStarted = true;
          await rename(source, join(retired, entry));
        }
      }
      this.snapshot.phase = 'starting';
      this.snapshot.message = '正在启动执行服务…';
      await this.runtime.start();
      if (this.runtime.readStatus().state !== 'ready') {
        throw new Error('RUNTIME_NOT_READY');
      }
      this.snapshot.phase = 'succeeded';
      this.snapshot.issue = null;
      this.snapshot.message =
        action === 'reset' ? '执行服务已恢复，请重新连接客户端并授权。' : '执行服务已恢复。';
    } catch {
      const phase = this.snapshot.phase;
      this.snapshot.phase = 'failed';
      this.snapshot.message =
        phase === 'stopping'
          ? '执行服务退出未获确认，尚未重置数据。'
          : !backupComplete && action === 'reset'
            ? '备份失败，尚未重置数据。请检查磁盘空间和目录权限。'
            : phase === 'starting'
              ? '执行服务仍无法启动，请查看详情。'
              : resetStarted
                ? '重置未全部完成，备份与原始数据已保留。请关闭占用文件的程序后重试。'
                : '备份已完成，尚未重置数据。请查看详情后重试。';
    } finally {
      this.busy = false;
      complete();
    }
  }
}
