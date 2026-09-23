/**
 * @author Codex
 * @description Bounds startup, flush, worker shutdown, and lease release for the local file-log destination.
 */

import { unlink } from 'node:fs/promises';
import type { FileLogLease } from './file-log-lease.js';
import type { FileLogTransport } from './file-log-transport.js';
import type { LogRetentionManager } from './log-retention.js';

const TRANSPORT_CLOSE_TIMEOUT_MS = 5000;
const TRANSPORT_START_TIMEOUT_MS = 5000;

export interface CloseFileLoggingOptions {
  transport?: FileLogTransport;
  retention?: LogRetentionManager;
  lease?: FileLogLease;
  onError?: () => void;
  activeMarkerPath?: string;
  closeTimeoutMs?: number;
}

/**
 * Resolves after the worker reports ready, emits an error, or exceeds the bounded startup window.
 *
 * @param transport Worker-backed local file transport.
 * @param onTimeout Callback that transitions the public health state.
 * @returns Whether the transport became ready within the startup window.
 */
export async function waitForTransportStartup(
  transport: FileLogTransport,
  onTimeout: () => void
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const finish = (started: boolean) => {
      clearTimeout(timeout);
      transport.off('ready', onReady);
      transport.off('error', onError);
      resolve(started);
    };
    const onReady = () => finish(true);
    const onError = () => finish(false);
    const timeout = setTimeout(() => {
      onTimeout();
      finish(false);
    }, TRANSPORT_START_TIMEOUT_MS);
    timeout.unref();
    transport.once('ready', onReady);
    transport.once('error', onError);
  });
}

/**
 * Stops scheduled work, drains the worker, and releases the directory lease without blocking shutdown forever.
 *
 * @param options File logging resources owned by one runtime.
 */
export async function closeFileLogging(options: CloseFileLoggingOptions): Promise<void> {
  let failed = false;
  let transportClosed = options.transport === undefined;
  try {
    await options.retention?.close();
  } catch {
    failed = true;
  }
  if (options.transport !== undefined) {
    try {
      await flushWithTimeout(options.transport, options.closeTimeoutMs);
    } catch {
      failed = true;
    }
    try {
      await endWithTimeout(options.transport, options.closeTimeoutMs);
      transportClosed = true;
    } catch {
      failed = true;
    }
  }
  if (transportClosed) {
    if (options.activeMarkerPath !== undefined) {
      try {
        await unlink(options.activeMarkerPath).catch((error: unknown) => {
          if (!hasErrorCode(error, 'ENOENT')) {
            throw error;
          }
        });
      } catch {
        failed = true;
      }
    }
    try {
      options.lease?.close();
    } catch {
      failed = true;
    }
  }
  if (failed) {
    options.onError?.();
  }
}

/**
 * Bounds worker flush latency so shutdown cannot hang indefinitely.
 */
async function flushWithTimeout(
  transport: FileLogTransport,
  timeoutMs: number = TRANSPORT_CLOSE_TIMEOUT_MS
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server file log flush timed out.')), timeoutMs);
    timeout.unref();
    transport.flush((error?: Error) => {
      clearTimeout(timeout);
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

/**
 * Waits briefly for the worker to close before releasing the cross-process directory lease.
 */
async function endWithTimeout(
  transport: FileLogTransport,
  timeoutMs: number = TRANSPORT_CLOSE_TIMEOUT_MS
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      transport.off('close', onClose);
      transport.off('error', onError);
    };
    const onClose = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Server file log transport close timed out.'));
    }, timeoutMs);
    timeout.unref();
    transport.once('close', onClose);
    transport.once('error', onError);
    transport.end();
  });
}

/**
 * Narrows portable Node.js failures without exposing infrastructure error content.
 */
function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
