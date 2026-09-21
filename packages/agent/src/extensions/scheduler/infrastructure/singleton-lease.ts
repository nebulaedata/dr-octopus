/**
 * @author Codex
 * @description Preserve Scheduler lock contracts through the shared local-daemon primitive.
 */
import { tryAcquireProcessLock } from '../../../lib/daemon-platform/singleton-lease.js';
import { ProcessLifecycleError } from '../../../lib/daemon-platform/error.js';
import { SchedulerLifecycleError } from '../definitions/lifecycle.js';
import type { SingletonLease } from '../definitions/lifecycle.js';

/**
 * Acquire a process-lifetime lock, preserving Scheduler-specific public error codes.
 */
export async function tryAcquireSingletonLease(path: string): Promise<SingletonLease | null> {
  try {
    return await tryAcquireProcessLock(path);
  } catch (error) {
    if (error instanceof ProcessLifecycleError) {
      throw new SchedulerLifecycleError(error.code.replace('PROCESS_', 'SCHEDULER_'), error.message, {
        cause: error,
      });
    }
    throw error;
  }
}
