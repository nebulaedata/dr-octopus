/**
 * @author Codex
 * @description Materializes genuine Pi report Sessions when a run settles before any model Session exists.
 */
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { PiSessionRepository } from '../../lib/runtime/pi-session-repository.js';
import type { SchedulerResult } from '@octopus/agent';

/**
 * Own only Host report files; Agent execution files remain under Scheduler lifecycle control.
 */
export class ScheduledResultArtifacts {
  readonly pi = new PiSessionRepository();
  /**
   * Set a Host-owned directory which cannot be selected by browser inputs.
   */
  constructor(private readonly directory: string) {}
  /**
   * Use Pi's public serialization without fabricating an assistant/model reply.
   */
  async report(result: SchedulerResult): Promise<{ id: string; path: string }> {
    const path = this.path(result.run.id);
    await mkdir(this.directory, { recursive: true });
    const manager = SessionManager.create(result.cwd, this.directory);
    manager.appendCustomMessageEntry(
      'octopus-scheduler-report',
      `${result.artifactError ? '执行记录文件缺失；本报告保留运行状态，不能据此断定任务未执行。' : '本次运行未创建模型执行会话。'}\n\n${result.run.summary ?? result.run.errorCode ?? result.run.status}`,
      true,
      { runId: result.run.id, taskId: result.run.taskId }
    );
    const entries = [manager.getHeader(), ...manager.getEntries()];
    try {
      await writeFile(path, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`, {
        flag: 'wx',
        encoding: 'utf8',
      });
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) {
        throw error;
      }
    }
    return { id: (await this.pi.readMetadata(path)).sessionId, path };
  }
  /**
   * Clean only a deterministic Host report after its canonical run was purged.
   */
  async removeReport(runId: string): Promise<void> {
    try {
      await unlink(this.path(runId));
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
        throw error;
      }
    }
  }
  /**
   * Validate a canonical run identity before forming a report path.
   */
  private path(runId: string): string {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(runId)) {
      throw new Error('Invalid run identity');
    }
    return join(this.directory, `${runId}.jsonl`);
  }
}
