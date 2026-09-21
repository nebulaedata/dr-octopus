/**
 * @author Codex
 * @description Enforces bounded retention for Server-owned rolled JSONL logs without following links.
 */

import { lstat, readFile, readdir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ServerFileLoggingConfig } from '../config/utils.js';

const LOG_FILE_PATTERN = /^server(?:\.\d{4}-\d{2}-\d{2})?\.\d+\.jsonl$/u;
const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;
const BYTES_PER_MEBIBYTE = 1024 * 1024;

interface RetainedLogFile {
  path: string;
  modifiedAtMs: number;
  size: number;
}

export interface LogRetentionPolicy {
  retentionDays: number;
  maxFiles: number;
  maxTotalSizeMb: number;
}

/**
 * Deletes only recognized Server log files until age, count, and total-size limits are satisfied.
 *
 * @param logsRoot Canonical Server logs directory.
 * @param policy Validated retention bounds.
 * @param nowMs Clock value injectable for deterministic tests.
 * @param activeFilePath Exact worker-published active file; cleanup safely skips when absent.
 */
export async function pruneServerLogFiles(
  logsRoot: string,
  policy: LogRetentionPolicy,
  nowMs: number = Date.now(),
  activeFilePath?: string
): Promise<void> {
  const files = await listManagedLogFiles(logsRoot);
  if (files.length <= 1) {
    return;
  }

  const active = files.find((file) => file.path === activeFilePath);
  if (active === undefined) {
    return;
  }
  files.sort((left, right) => left.modifiedAtMs - right.modifiedAtMs);
  const removable = files.filter((file) => file !== active);
  const cutoff = nowMs - policy.retentionDays * 24 * 60 * 60 * 1000;
  const retained = [...files];

  for (const file of removable) {
    if (file.modifiedAtMs < cutoff) {
      await deleteManagedFile(file, retained);
    }
  }

  for (const file of [...retained]) {
    if (retained.length <= policy.maxFiles || file === active) {
      continue;
    }
    await deleteManagedFile(file, retained);
  }

  const maximumBytes = policy.maxTotalSizeMb * BYTES_PER_MEBIBYTE;
  for (const file of [...retained]) {
    const totalBytes = retained.reduce((sum, candidate) => sum + candidate.size, 0);
    if (totalBytes <= maximumBytes || file === active) {
      continue;
    }
    await deleteManagedFile(file, retained);
  }
}

/**
 * Runs retention once at startup and periodically while isolating cleanup failures from business work.
 */
export class LogRetentionManager {
  readonly #logsRoot: string;
  readonly #policy: LogRetentionPolicy;
  readonly #onError: (error: unknown) => void;
  #timer?: NodeJS.Timeout;
  #running?: Promise<void>;
  #closed = false;

  /**
   * @param logsRoot Canonical Server logs directory.
   * @param config Validated file logging policy.
   * @param onError Failure callback that must not throw.
   */
  public constructor(logsRoot: string, config: ServerFileLoggingConfig, onError: (error: unknown) => void) {
    this.#logsRoot = logsRoot;
    this.#policy = config;
    this.#onError = onError;
  }

  /**
   * Starts one immediate cleanup and an unref'ed low-frequency timer.
   */
  public start(): Promise<void> {
    if (this.#closed) {
      return Promise.resolve();
    }
    if (this.#timer !== undefined) {
      return this.#running ?? Promise.resolve();
    }
    this.#timer = setInterval(() => void this.run(), RETENTION_INTERVAL_MS);
    this.#timer.unref();
    return this.run();
  }

  /**
   * Stops future cleanup and waits for an in-flight single-flight pass.
   */
  public async close(): Promise<void> {
    this.#closed = true;
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
    await this.#running;
  }

  /**
   * Coalesces overlapping triggers into one cleanup pass.
   */
  private run(): Promise<void> {
    if (this.#closed) {
      return Promise.resolve();
    }
    this.#running ??= readActiveLogFilePath(this.#logsRoot)
      .then((activeFilePath) => pruneServerLogFiles(this.#logsRoot, this.#policy, Date.now(), activeFilePath))
      .catch((error: unknown) => this.#onError(error))
      .finally(() => {
        this.#running = undefined;
      });
    return this.#running;
  }
}

/**
 * Resolves only a valid managed filename published by the rolling worker.
 */
async function readActiveLogFilePath(logsRoot: string): Promise<string | undefined> {
  try {
    const fileName = (await readFile(join(logsRoot, '.server-log-active'), 'utf8')).trim();
    if (!LOG_FILE_PATTERN.test(fileName)) {
      return undefined;
    }
    const canonicalRoot = resolve(logsRoot);
    const candidate = resolve(canonicalRoot, fileName);
    return isInsideRoot(canonicalRoot, candidate) ? candidate : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Lists only regular files whose resolved paths and names remain inside the managed directory.
 */
async function listManagedLogFiles(logsRoot: string): Promise<RetainedLogFile[]> {
  const canonicalRoot = resolve(logsRoot);
  const entries = await readdir(canonicalRoot, { withFileTypes: true });
  const files: RetainedLogFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !LOG_FILE_PATTERN.test(entry.name)) {
      continue;
    }
    const path = resolve(canonicalRoot, entry.name);
    if (!isInsideRoot(canonicalRoot, path)) {
      continue;
    }
    const stats = await lstat(path);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      continue;
    }
    files.push({ path, modifiedAtMs: stats.mtimeMs, size: stats.size });
  }
  return files;
}

/**
 * Verifies a resolved child path remains below the configured log root on every platform.
 */
function isInsideRoot(canonicalRoot: string, candidate: string): boolean {
  return candidate.startsWith(`${canonicalRoot}\\`) || candidate.startsWith(`${canonicalRoot}/`);
}

/**
 * Removes one file and updates the in-memory retention view only after deletion succeeds.
 */
async function deleteManagedFile(file: RetainedLogFile, retained: RetainedLogFile[]): Promise<void> {
  await unlink(file.path);
  const index = retained.indexOf(file);
  if (index >= 0) {
    retained.splice(index, 1);
  }
}
