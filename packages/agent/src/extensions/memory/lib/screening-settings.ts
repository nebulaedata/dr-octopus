/**
 * @author Codex
 * @description Owns automatic-memory screening policy independently of Jev connection configuration.
 */
import { join } from 'node:path';
import { memoryScreeningSettingsSchema, memoryScreeningUpdateSchema } from '@octopus/shared/protocol/memory';
import { SettingsFile } from '../../../lib/settings-file.js';
import { MemoryError } from '../definitions/error.js';
import { resolveMemoryPaths } from './paths.js';
import type { MemoryScreeningSnapshot, MemoryScreeningUpdate } from '@octopus/shared/protocol/memory';

export class MemoryScreeningSettingsStore {
  private readonly file;
  /**
   * Keep policy alongside the global memory resources without requiring the daemon to run.
   */
  constructor(dataRoot?: string) {
    this.file = new SettingsFile(
      join(resolveMemoryPaths(dataRoot).directory, 'screening.json'),
      (input) => memoryScreeningSettingsSchema.parse(input),
      (code) => new MemoryError(`MEMORY_SCREENING_${code}`, 'Memory screening configuration failed.')
    );
  }
  /**
   * Read the latest policy; screening is disabled until explicitly saved.
   */
  async get(): Promise<MemoryScreeningSnapshot> {
    const { configuration, revision } = await this.file.load();
    return { ...configuration, revision };
  }
  /**
   * Save only memory screening policy, retaining revision fencing across independent editors.
   */
  async update(input: MemoryScreeningUpdate): Promise<MemoryScreeningSnapshot> {
    const parsed = memoryScreeningUpdateSchema.safeParse(input);
    if (!parsed.success) {
      throw new MemoryError('MEMORY_SCREENING_INVALID', 'Invalid memory screening settings.');
    }
    const { revision, ...settings } = parsed.data;
    await this.file.update(revision, settings);
    return this.get();
  }
}
