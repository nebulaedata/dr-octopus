/**
 * @author Codex
 * @description Reads bounded environment documents and atomically updates them under an exclusive writer lock.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { EnvironmentError } from './types.js';
import type { EnvironmentValues, EnvironmentUpdateOptions } from './types.js';

/**
 * Checks portable variable names and string values without echoing values into errors.
 */
export function validateEnvironment(values: unknown): asserts values is Record<string, string> {
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new EnvironmentError('ENV_INVALID', 'Environment configuration must be a JSON object.');
  }
  const entries = Object.entries(values);
  if (entries.length > 256) {
    throw new EnvironmentError('ENV_INVALID', 'Environment configuration supports at most 256 entries.');
  }
  const names = new Set<string>();
  for (const [key, value] of entries) {
    if (
      !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) ||
      ['__proto__', 'constructor', 'prototype'].includes(key)
    ) {
      throw new EnvironmentError('ENV_INVALID', 'Invalid environment variable name.');
    }
    if (names.has(key.toUpperCase())) {
      throw new EnvironmentError('ENV_INVALID', 'Environment variable names must not differ only in case.');
    }
    names.add(key.toUpperCase());
    if (typeof value !== 'string' || value.includes('\0') || value.length > 8192) {
      throw new EnvironmentError(
        'ENV_INVALID',
        `${key} must be a string without NUL, at most 8192 characters.`
      );
    }
  }
}

/**
 * Reads an optional bounded text file; missing files are distinct from unreadable files.
 */
export function readEnvironmentText(path: string): string | undefined {
  try {
    if (statSync(path).size > 1024 * 1024) {
      throw new EnvironmentError('ENV_INVALID', 'Environment file exceeds 1 MiB.');
    }
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    if (error instanceof EnvironmentError) {
      throw error;
    }
    throw new EnvironmentError('ENV_IO', 'Cannot read environment configuration.');
  }
}

/**
 * Reads and fingerprints the exact document for optimistic concurrency control.
 */
export function readEnvironmentFile(path: string): { persisted: EnvironmentValues; revision: string } {
  const text = readEnvironmentText(path);
  let persisted: unknown;
  try {
    persisted = text === undefined ? {} : JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new EnvironmentError('ENV_INVALID', 'Environment configuration contains invalid JSON.');
  }
  validateEnvironment(persisted);
  return {
    persisted: Object.freeze(persisted),
    revision: createHash('sha256')
      .update(text === undefined ? 'missing' : 'file:' + text)
      .digest('hex'),
  };
}

/**
 * Applies a patch only to the expected revision; null deletes a persisted override.
 * All SDK writers use the lock. A crashed writer leaves a lock requiring operator recovery.
 */
export async function patchEnvironmentFile(
  path: string,
  revision: string,
  changes: Readonly<Record<string, string | null>>,
  validate?: (values: EnvironmentValues) => void,
  options?: EnvironmentUpdateOptions
): Promise<{ persisted: EnvironmentValues; revision: string }> {
  validateEnvironment(Object.fromEntries(Object.entries(changes).map(([key, value]) => [key, value ?? ''])));
  const lockPath = path + '.lock';
  const temporary = path + '.' + randomUUID() + '.tmp';
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const lock = await open(lockPath, 'wx', 0o600).catch((error: NodeJS.ErrnoException) => {
    throw new EnvironmentError(
      error.code === 'EEXIST' ? 'ENV_BUSY' : 'ENV_IO',
      error.code === 'EEXIST'
        ? 'Environment configuration is locked by another writer.'
        : 'Cannot lock environment configuration.'
    );
  });
  let checkError: unknown;
  try {
    const current = readEnvironmentFile(path);
    if (revision !== current.revision) {
      throw new EnvironmentError('ENV_CONFLICT', 'Environment configuration changed. Reload before saving.');
    }
    const next = { ...current.persisted };
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) {
        delete next[key];
      } else {
        next[key] = value;
      }
    }
    validateEnvironment(next);
    validate?.(next);
    try {
      options?.check?.(current.persisted, next);
    } catch (error) {
      checkError = error;
      throw error;
    }
    if (
      Object.keys(next).length === Object.keys(current.persisted).length &&
      Object.entries(next).every(([key, value]) => current.persisted[key] === value)
    ) {
      return current;
    }
    const content = JSON.stringify(next, null, 2) + '\n';
    if (Buffer.byteLength(content, 'utf8') > 1024 * 1024) {
      throw new EnvironmentError('ENV_INVALID', 'Environment file exceeds 1 MiB.');
    }
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(content);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    return {
      persisted: Object.freeze(next),
      revision: createHash('sha256')
        .update('file:' + content)
        .digest('hex'),
    };
  } catch (error) {
    if (error instanceof EnvironmentError || error === checkError) {
      throw error;
    }
    throw new EnvironmentError('ENV_IO', 'Cannot update environment configuration.');
  } finally {
    await rm(temporary, { force: true });
    await lock.close();
    await rm(lockPath, { force: true });
  }
}
