/**
 * @author Codex
 * @description Provides atomic revision-checked JSON storage for independent Agent configuration owners.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { tryAcquireProcessLock } from './daemon-platform/singleton-lease.js';

type SettingsFailure = 'INVALID' | 'IO' | 'BUSY' | 'CONFLICT';

export class SettingsFile<T> {
  /**
   * Bind a trusted path, its owning schema and safe domain error factory without creating files.
   */
  constructor(
    readonly path: string,
    private readonly parse: (input: unknown) => T,
    private readonly failure: (code: SettingsFailure) => Error
  ) {
    if (!isAbsolute(path)) {
      throw failure('INVALID');
    }
  }
  /**
   * Missing files expose defaults without writing; malformed files never silently reset policy.
   */
  async load(): Promise<{ configuration: T; revision: string }> {
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { configuration: this.parse({}), revision: 'absent' };
      }
      throw this.failure('IO');
    }
    try {
      if (Buffer.byteLength(raw) > 16384) {
        throw this.failure('INVALID');
      }
      return {
        configuration: this.parse(JSON.parse(raw)),
        revision: createHash('sha256').update(raw).digest('hex'),
      };
    } catch {
      throw this.failure('INVALID');
    }
  }
  /**
   * Replace the validated document under an OS lock only if the observed revision is still current.
   */
  async update(revision: string, configuration: T): Promise<void> {
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true });
    const lock = await tryAcquireProcessLock(this.path + '.lock');
    if (!lock) {
      throw this.failure('BUSY');
    }
    const temporary = join(directory, `.settings-${randomUUID()}.tmp`);
    try {
      const current = await this.load();
      if (current.revision !== revision) {
        throw this.failure('CONFLICT');
      }
      await writeFile(temporary, JSON.stringify(configuration, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      await rename(temporary, this.path);
    } finally {
      try {
        await rm(temporary, { force: true });
      } finally {
        lock.release();
      }
    }
  }
}
