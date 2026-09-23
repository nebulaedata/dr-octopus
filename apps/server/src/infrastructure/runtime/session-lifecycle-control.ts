/**
 * @author Codex
 * @description Serializes restart and deletion ownership while retaining bounded restart state through process gaps.
 */
import { ApplicationError } from '../errors/application-error.js';
import type { RestartSessionBody, SessionRuntimeControlDto } from '@octopus/shared/protocol';

export class SessionLifecycleControl {
  private locked = false;
  private deleted = false;
  private unsafe = false;
  private target: string | undefined;
  private pending: Promise<unknown> | undefined;
  private state: SessionRuntimeControlDto['restart'] = { status: 'idle' };

  /**
   * Rejects new ordinary work while a lifecycle owner controls the Session.
   */
  assertAvailable(): void {
    if (this.unsafe) {
      throw new ApplicationError('SESSION_RESTART_FAILED', '无法确认旧进程退出，会话已停止接受新任务。', {
        statusCode: 503,
        retryable: false,
      });
    }
    if (this.deleted) {
      throw new ApplicationError('SESSION_NOT_FOUND', '会话已删除。', { statusCode: 404 });
    }
    if (this.locked) {
      throw new ApplicationError('SESSION_RESTART_IN_PROGRESS', '会话正在重启或停止，请稍后重试。', {
        statusCode: 409,
      });
    }
  }

  /**
   * Exposes an immutable business operation snapshot even when no runtime exists.
   */
  snapshot(): SessionRuntimeControlDto['restart'] {
    if (this.unsafe) {
      return {
        status: 'failed',
        error: {
          code: 'SESSION_RESTART_FAILED',
          message: '无法确认旧进程退出，请检查服务进程状态。',
          retryable: false,
        },
      };
    }
    return { ...this.state, ...(this.state.error ? { error: { ...this.state.error } } : {}) };
  }

  /**
   * Runs a deletion with the same gate used by restart, without changing restart presentation.
   */
  async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    this.assertAvailable();
    this.locked = true;
    try {
      return await operation();
    } finally {
      this.locked = false;
    }
  }

  /**
   * Fences callers that resolved Session metadata before its deletion committed.
   */
  markDeleted(): void {
    this.deleted = true;
  }

  /**
   * Quarantines a Session whose failed cleanup cannot prove exclusive file ownership.
   */
  markUnsafe(): void {
    this.unsafe = true;
  }

  /**
   * Shares an accepted restart of the same generation; timeout retains the gate until cleanup settles.
   */
  restart<T>(
    request: RestartSessionBody,
    operation: (assertLive: () => void) => Promise<T>,
    publish: () => void,
    timeoutMs: number
  ): Promise<T> {
    const target = JSON.stringify(request.expectedRuntime);
    if (this.pending && this.target === target) {
      return this.pending as Promise<T>;
    }
    this.assertAvailable();
    this.locked = true;
    this.target = target;
    this.state = { status: 'restarting' };
    publish();
    let expired = false;
    let timer: ReturnType<typeof setTimeout>;
    const timeoutError = new ApplicationError(
      'SESSION_RESTART_TIMEOUT',
      '重启等待超时，正在等待进程清理完成。',
      { statusCode: 504 }
    );
    const assertLive = (): void => {
      if (expired) {
        throw timeoutError;
      }
    };
    const work = Promise.resolve().then(() => operation(assertLive));
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        expired = true;
        this.state = {
          status: 'failed',
          error: { code: timeoutError.code, message: timeoutError.message, retryable: false },
        };
        publish();
        reject(timeoutError);
      }, timeoutMs);
      timer.unref?.();
    });
    const settled = work
      .then(
        (result) => {
          this.state = { status: 'idle' };
          return result;
        },
        (error: unknown) => {
          const rejected = error instanceof ApplicationError && error.statusCode === 409 && !expired;
          this.state = rejected
            ? { status: 'idle' }
            : {
                status: 'failed',
                error: {
                  code: expired ? 'SESSION_RESTART_TIMEOUT' : 'SESSION_RESTART_FAILED',
                  message: expired ? '进程清理已完成，可以重试。' : '会话重启失败，请重试。',
                  retryable: true,
                },
              };
          throw error;
        }
      )
      .finally(() => {
        clearTimeout(timer);
        this.locked = false;
        this.pending = undefined;
        this.target = undefined;
        publish();
      });
    this.pending = Promise.race([settled, timeout]);
    return this.pending as Promise<T>;
  }
}
