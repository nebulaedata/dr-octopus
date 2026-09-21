/**
 * @author Codex
 * @description Resolves the built Scheduler process and its bundled resources for source and compiled callers.
 */
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SchedulerLifecycleError } from '../definitions/lifecycle.js';

/**
 * Keep daemon, Runner and migrations in the same build, even when the CLI is loaded through tsx.
 *
 * @returns Absolute JavaScript entry suitable for a detached Node process.
 * @throws When the package has not been built or its daemon entry is unavailable.
 */
export async function resolveSchedulerDaemonEntry(): Promise<string> {
  const entry = fileURLToPath(
    new URL(
      import.meta.url.endsWith('.ts')
        ? '../../../../dist/extensions/scheduler/daemon/entry.js'
        : '../daemon/entry.js',
      import.meta.url
    )
  );
  try {
    await access(entry);
  } catch (cause) {
    throw new SchedulerLifecycleError(
      'SCHEDULER_BUILD_REQUIRED',
      'Scheduler requires a built Agent package. Run pnpm build:agent before starting the service.',
      { cause }
    );
  }
  return entry;
}
