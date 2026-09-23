/**
 * @author Codex
 * @description Prevents multiple Server processes from concurrently owning one local rolling-log directory.
 */

import { closeSync, fsyncSync, linkSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

interface FileLogLeaseRecord {
  pid: number;
  token: string;
}

const LEASE_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface FileLogLease {
  /**
   * Releases the owned lock only if its token still matches this process instance.
   */
  close(): void;
}

/**
 * Acquires an exclusive writer marker and recovers one verifiably stale process marker.
 *
 * @param logsRoot Existing canonical logs directory.
 * @returns An idempotent lease owned by the caller until transport shutdown.
 * @throws When another live or unverifiable process owns the directory.
 */
export function acquireFileLogLease(logsRoot: string): FileLogLease {
  const lockPath = join(logsRoot, '.server-log-writer.lock');
  const record: FileLogLeaseRecord = { pid: process.pid, token: randomUUID() };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeExclusiveRecord(lockPath, record);
      return createLease(lockPath, record.token);
    } catch (error) {
      if (!hasErrorCode(error, 'EEXIST') || attempt > 0 || !recoverStaleLease(lockPath)) {
        throw new Error('Server file logging directory is already owned by another process.', {
          cause: error,
        });
      }
    }
  }
  throw new Error('Server file logging directory lease could not be acquired.');
}

/**
 * Atomically creates and writes one private lock record.
 */
function writeExclusiveRecord(path: string, record: FileLogLeaseRecord): void {
  const temporaryPath = `${path}.candidate-${record.token}`;
  let descriptor: number | undefined;
  let failure: unknown;
  let published = false;
  try {
    descriptor = openSync(temporaryPath, 'wx', 0o600);
    writeFileSync(descriptor, JSON.stringify(record), 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    linkSync(temporaryPath, path);
    published = true;
  } catch (error) {
    failure = error;
  }
  if (descriptor !== undefined) {
    try {
      closeSync(descriptor);
    } catch (error) {
      failure ??= error;
    }
  }
  try {
    unlinkSync(temporaryPath);
  } catch (error) {
    if (!published && !hasErrorCode(error, 'ENOENT')) {
      failure ??= error;
    }
  }
  if (failure !== undefined) {
    throw failure instanceof Error
      ? failure
      : new Error('Server file logging lease record could not be published.', { cause: failure });
  }
}

/**
 * Removes a valid lock only when its recorded process no longer exists.
 */
function recoverStaleLease(lockPath: string): boolean {
  const record = readLeaseRecord(lockPath);
  if (record === undefined || isProcessAlive(record.pid)) {
    return false;
  }
  const recoveryPath = `${lockPath}.recovery-${record.token}`;
  const recoveryRecord: FileLogLeaseRecord = { pid: process.pid, token: randomUUID() };
  try {
    writeExclusiveRecord(recoveryPath, recoveryRecord);
  } catch {
    return false;
  }
  try {
    const current = readLeaseRecord(lockPath);
    if (current?.token !== record.token || isProcessAlive(current.pid)) {
      return false;
    }
    unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  } finally {
    createLease(recoveryPath, recoveryRecord.token).close();
  }
}

/**
 * Parses only the minimal trusted lock shape needed for stale-process detection.
 */
function readLeaseRecord(path: string): FileLogLeaseRecord | undefined {
  try {
    const candidate = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (typeof candidate === 'object' && candidate !== null) {
      const pid = 'pid' in candidate ? candidate.pid : undefined;
      const token = 'token' in candidate ? candidate.token : undefined;
      if (
        typeof pid === 'number' &&
        Number.isSafeInteger(pid) &&
        pid > 0 &&
        typeof token === 'string' &&
        LEASE_TOKEN_PATTERN.test(token)
      ) {
        return { pid, token };
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Treats permission-denied probes as live so an uncertain lock is never removed.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !hasErrorCode(error, 'ESRCH');
  }
}

/**
 * Creates an idempotent token-fenced release operation.
 */
function createLease(lockPath: string, token: string): FileLogLease {
  let closed = false;
  return {
    close() {
      if (closed) {
        return;
      }
      closed = true;
      if (readLeaseRecord(lockPath)?.token !== token) {
        return;
      }
      try {
        unlinkSync(lockPath);
      } catch (error) {
        if (!hasErrorCode(error, 'ENOENT')) {
          throw error;
        }
      }
    },
  };
}

/**
 * Narrows portable Node.js filesystem failures by their stable code.
 */
function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
