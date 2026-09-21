/**
 * @author Codex
 * @description 使用 Pi 公共 SessionManager API排他初始化并安全清理 Workspace 空 Session
 */

import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import type { WorkspaceSessionBootstrap, WorkspaceSessionBootstrapResult } from '../definitions/port.js';

const MAX_PATH_ATTEMPTS = 3;

/**
 * 为 Workspace open 工作流创建由 Pi 自己编码的 Session header。
 */
export class PiWorkspaceSessionBootstrap implements WorkspaceSessionBootstrap {
  /**
   * @description 创建目标 Session，并返回只会删除该空 Session 的幂等回滚函数。
   *
   * @param cwd 将写入 Pi Session header 的目标 Workspace cwd。
   * @param current 当前 runtime 的 cwd 与已解析 Session 目录，用于区分默认按 cwd 分目录和自定义目录。
   */
  public async create(
    cwd: string,
    current?: { cwd: string; sessionDir: string }
  ): Promise<WorkspaceSessionBootstrapResult> {
    const sessionDir = current === undefined ? undefined : this.#resolveTargetSessionDir(current);
    for (let attempt = 0; attempt < MAX_PATH_ATTEMPTS; attempt += 1) {
      const manager = SessionManager.create(cwd, sessionDir);
      const sessionPath = manager.getSessionFile();
      if (sessionPath === undefined) {
        throw new Error('Pi did not allocate a persisted Session path.');
      }
      try {
        await mkdir(dirname(sessionPath), { recursive: true });
        const handle = await open(sessionPath, 'wx');
        await handle.close();
      } catch (error) {
        if (this.#isAlreadyExists(error)) {
          continue;
        }
        throw error;
      }

      try {
        const initialized = SessionManager.open(sessionPath, sessionDir, cwd);
        const sessionId = initialized.getSessionId();
        return {
          sessionPath,
          cleanup: async () => this.#cleanupEmptySession(sessionPath, sessionId),
        };
      } catch (error) {
        await unlink(sessionPath).catch(() => undefined);
        throw error;
      }
    }
    throw new Error('Could not allocate a unique Pi Session path.');
  }

  /**
   * 使用 Pi 自己的默认目录计算结果判断当前目录是否来自显式覆盖。
   */
  #resolveTargetSessionDir(current: { cwd: string; sessionDir: string }): string | undefined {
    const defaultCurrentDir = SessionManager.create(current.cwd).getSessionDir();
    return this.#pathsEqual(defaultCurrentDir, current.sessionDir) ? undefined : current.sessionDir;
  }

  /**
   * 按平台语义比较规范路径。
   */
  #pathsEqual(left: string, right: string): boolean {
    const normalizedLeft = resolve(left);
    const normalizedRight = resolve(right);
    return process.platform === 'win32'
      ? normalizedLeft.toLocaleLowerCase('en-US') === normalizedRight.toLocaleLowerCase('en-US')
      : normalizedLeft === normalizedRight;
  }

  /**
   * 仅删除仍只有本次 Session header 的文件，避免清理已被 Pi 使用的会话。
   */
  async #cleanupEmptySession(sessionPath: string, sessionId: string): Promise<void> {
    try {
      const lines = (await readFile(sessionPath, 'utf8'))
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines.length !== 1) {
        return;
      }
      const header = JSON.parse(lines[0] ?? '') as Record<string, unknown>;
      if (header['type'] === 'session' && header['id'] === sessionId) {
        await unlink(sessionPath);
      }
    } catch (error) {
      if (!this.#isNotFound(error)) {
        throw error;
      }
    }
  }

  /**
   * 判断 Node 文件系统错误是否表示排他创建冲突。
   */
  #isAlreadyExists(error: unknown): boolean {
    return this.#errorCode(error) === 'EEXIST';
  }

  /**
   * 判断清理目标是否已不存在。
   */
  #isNotFound(error: unknown): boolean {
    return this.#errorCode(error) === 'ENOENT';
  }

  /**
   * 安全读取 NodeJS.ErrnoException 错误码。
   */
  #errorCode(error: unknown): string | undefined {
    return error instanceof Error && 'code' in error ? (error as NodeJS.ErrnoException).code : undefined;
  }
}
