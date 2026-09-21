/**
 * @author Codex
 * @description Deletes scheduler-owned run directories after validating resolved containment.
 */
import { existsSync, realpathSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { SchedulerTaskError } from '../definitions/task-error.js';

/**
 * Validate every target first; failures retain database ownership so deletion can be retried.
 */
export function purgeRunArtifacts(databasePath: string, runIds: string[]): void {
  const directory = resolve(dirname(databasePath), 'runs');
  if (!existsSync(directory)) {
    return;
  }
  const root = realpathSync(directory);
  if (root !== directory) {
    throw new SchedulerTaskError('SCHEDULE_STORAGE_UNAVAILABLE', 'Run artifact root must not be redirected');
  }
  const targets = runIds.map((id) => {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) {
      throw new SchedulerTaskError('SCHEDULE_STORAGE_UNAVAILABLE', 'Invalid run artifact identity');
    }
    const target = resolve(join(root, id));
    const resolved = existsSync(target) ? realpathSync(target) : target;
    const suffix = relative(root, resolved);
    if (!suffix || suffix.startsWith('..') || isAbsolute(suffix) || resolved !== target) {
      throw new SchedulerTaskError(
        'SCHEDULE_STORAGE_UNAVAILABLE',
        'Run artifact escaped its owned directory'
      );
    }
    return target;
  });
  for (const target of targets) {
    rmSync(target, { recursive: true, force: true });
  }
}
