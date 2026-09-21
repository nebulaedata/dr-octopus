/**
 * @author Codex
 * @description Preserve Scheduler launch APIs while using the shared verified detached process launcher.
 */
import { launchDetachedNode as launch } from '../../../lib/daemon-platform/detached-launcher.js';
import { ProcessLifecycleError } from '../../../lib/daemon-platform/error.js';
import { SchedulerLifecycleError } from '../definitions/lifecycle.js';
export { quoteWindowsArgument } from '../../../lib/daemon-platform/detached-launcher.js';

/**
 * Start a detached child without changing Scheduler-specific lifecycle error contracts.
 */
export async function launchDetachedNode(args: string[], cwd: string): Promise<number> {
  try {
    return await launch(args, cwd);
  } catch (error) {
    if (error instanceof ProcessLifecycleError) {
      throw new SchedulerLifecycleError(error.code.replace('PROCESS_', 'SCHEDULER_'), error.message, {
        cause: error,
      });
    }
    throw error;
  }
}
