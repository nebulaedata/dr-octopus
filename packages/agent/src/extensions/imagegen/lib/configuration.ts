/**
 * @author Codex
 * @description Stores the independent image default atomically without retaining credentials.
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ImagegenConfigSchema } from '@octopus/shared/protocol';
import type { ImagegenConfig } from '@octopus/shared/protocol';

const pendingWrites = new Map<string, Promise<void>>();

/**
 * Reads the latest complete default; missing files mean not configured.
 */
export async function readImagegenConfig(agentDir: string): Promise<ImagegenConfig | null> {
  try {
    const value: unknown = JSON.parse(await readFile(join(agentDir, 'imagegen.json'), 'utf8'));
    return value === null ? null : ImagegenConfigSchema.parse(value);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Atomically replaces the entire independent config; concurrent complete writes are last-writer-wins.
 */
export async function saveImagegenConfig(agentDir: string, value: ImagegenConfig | null): Promise<void> {
  const key = resolve(agentDir);
  const pending = (pendingWrites.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => writeConfiguration(key, value));
  pendingWrites.set(key, pending);
  try {
    await pending;
  } finally {
    if (pendingWrites.get(key) === pending) {
      pendingWrites.delete(key);
    }
  }
}

/**
 * Publishes a complete config under the per-directory write queue.
 */
async function writeConfiguration(agentDir: string, value: ImagegenConfig | null): Promise<void> {
  const config = value === null ? null : ImagegenConfigSchema.parse(value);
  await mkdir(agentDir, { recursive: true });
  const temporary = join(agentDir, `.imagegen-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await rename(temporary, join(agentDir, 'imagegen.json'));
  } finally {
    await rm(temporary, { force: true });
  }
}
