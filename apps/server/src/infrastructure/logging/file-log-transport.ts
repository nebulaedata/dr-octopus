/**
 * @author Codex
 * @description Creates and preflights the isolated Pino rolling-file transport owned by Octopus Server.
 */

import { chmodSync, closeSync, mkdirSync, openSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import pino from 'pino';
import type { ServerFileLoggingConfig } from '../config/utils.js';

export type FileLogTransport = ReturnType<typeof pino.transport>;

/**
 * Verifies directory writability before a worker is created so required mode can fail deterministically.
 *
 * @param logsRoot Canonical Server-owned logs directory.
 * @throws When the directory cannot be created or written.
 */
export function preflightFileLogging(logsRoot: string): void {
  mkdirSync(logsRoot, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') {
    chmodSync(logsRoot, 0o700);
  }
  const probePath = join(logsRoot, `.octopus-log-probe-${String(process.pid)}-${randomUUID()}`);
  const descriptor = openSync(probePath, 'wx', 0o600);
  let cleanupError: unknown;
  try {
    closeSync(descriptor);
  } catch (error) {
    cleanupError = error;
  }
  try {
    unlinkSync(probePath);
  } catch (error) {
    cleanupError ??= error;
  }
  if (cleanupError !== undefined) {
    throw cleanupError instanceof Error
      ? cleanupError
      : new Error('Server file logging preflight cleanup failed.', { cause: cleanupError });
  }
}

/**
 * Starts a worker-backed rolling JSONL destination after successful local preflight.
 *
 * @param logsRoot Canonical Server-owned logs directory.
 * @param config Validated file logging policy.
 * @returns A Pino ThreadStream whose lifecycle remains owned by ServerLoggerRuntime.
 */
export function createFileLogTransport(logsRoot: string, config: ServerFileLoggingConfig): FileLogTransport {
  return pino.transport({
    target: new URL('./file-log-worker.js', import.meta.url).href,
    options: {
      file: join(logsRoot, 'server.jsonl'),
      activeMarkerPath: join(logsRoot, '.server-log-active'),
      frequency: 'daily',
      dateFormat: 'yyyy-MM-dd',
      size: `${String(config.maxSizeMb)}m`,
      mkdir: true,
      symlink: false,
      mode: 0o600,
    },
  });
}

/**
 * Removes a marker left by a previously confirmed-dead lease owner before a new worker starts.
 *
 * @param logsRoot Canonical Server-owned logs directory.
 */
export function clearActiveLogMarker(logsRoot: string): void {
  try {
    unlinkSync(join(logsRoot, '.server-log-active'));
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw error;
    }
  }
}
