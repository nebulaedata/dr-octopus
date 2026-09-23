/**
 * @author Codex
 * @description Owns Scheduler result synchronization subscriptions and their shutdown barrier.
 */
import { subscribeSchedulerChanges } from '@octopus/agent';
import type { SchedulerChangeSubscription } from '@octopus/agent';
import type { ScheduledResultSynchronization } from '../scheduled-tasks.service.js';
/**
 * Creates a dormant worker whose lifecycle is controlled by the owning module.
 */
export function createResultSyncWorker(
  agentDir: string,
  results: ScheduledResultSynchronization,
  onChanged: () => void
) {
  let subscription: SchedulerChangeSubscription | undefined;
  return {
    /**
     * Starts the existing result sweep and daemon invalidation stream.
     */
    start(): void {
      results.start();
      subscription = subscribeSchedulerChanges(agentDir, () => {
        onChanged();
        results.requestSync();
      });
    },
    /**
     * Drains the subscription before closing accepted result work.
     */
    async close(): Promise<void> {
      await subscription?.close();
      await results.close();
    },
  };
}
