/**
 * @author Codex
 * @description Bounds image preparation by process lifetime, wall time, native memory and tool cancellation.
 */
import { fork } from 'node:child_process';
import { KnowledgeError } from '../definitions/error.js';
import type { PreparedOcrImage } from '../definitions/ocr-image.js';

/**
 * Wait for the owned worker to exit before settling, so cancelled tools leave no native image task running.
 */
export async function runOcrImageWorker(bytes: Buffer, signal?: AbortSignal): Promise<PreparedOcrImage> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const entry = new URL(
      import.meta.url.endsWith('.ts')
        ? '../../../../dist/extensions/knowledge/lib/ocr-image-worker-entry.js'
        : './ocr-image-worker-entry.js',
      import.meta.url
    );
    const child = fork(entry, [], {
      execArgv: ['--max-old-space-size=128'],
      env: { NODE_ENV: 'production' },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      serialization: 'advanced',
    });
    let settled = false;
    const timer = setTimeout(
      () => finish(new KnowledgeError('OCR_IMAGE_TIMEOUT', '图片预处理超过 30 秒，请先分块处理')),
      30_000
    );
    /**
     * Settle once, disposing the exact process owned by this invocation.
     */
    function finish(error?: Error, result?: PreparedOcrImage): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      const complete = () => (error ? reject(error) : resolve(result!));
      if (child.exitCode !== null || child.signalCode !== null || !child.pid) {
        complete();
      } else {
        child.once('exit', complete);
        child.kill('SIGKILL');
      }
    }
    /**
     * Propagate the original cancellation reason after stopping native work.
     */
    function abort(): void {
      finish(signal?.reason instanceof Error ? signal.reason : new Error('OCR cancelled'));
    }
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', () =>
      finish(new KnowledgeError('OCR_IMAGE_PREPARATION_FAILED', '图片预处理进程无法启动'))
    );
    child.on('exit', () =>
      finish(new KnowledgeError('OCR_IMAGE_PREPARATION_FAILED', '图片预处理进程异常退出'))
    );
    child.on(
      'message',
      (message: { rss?: number; error?: { code: string; message: string }; result?: PreparedOcrImage }) => {
        if (message.rss && message.rss > 768 * 1024 * 1024) {
          finish(new KnowledgeError('OCR_IMAGE_MEMORY_LIMIT', '图片预处理超过内存预算，请先分块处理'));
        } else if (message.error) {
          finish(new KnowledgeError(message.error.code, message.error.message));
        } else if (message.result) {
          finish(undefined, message.result);
        }
      }
    );
    child.send(bytes, (error) => {
      if (error) {
        finish(new KnowledgeError('OCR_IMAGE_PREPARATION_FAILED', '图片预处理输入传输失败'));
      }
    });
    if (signal?.aborted) {
      abort();
    }
  });
}
