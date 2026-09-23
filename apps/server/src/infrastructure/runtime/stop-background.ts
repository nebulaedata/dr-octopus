/**
 * @author Codex
 * @description Verifies explicit background stop barriers independently of Pi command acknowledgements.
 */
import { randomUUID } from 'node:crypto';
import { BACKGROUND_COMMAND } from '@octopus/shared/protocol';
import { responseData, responseSucceeded } from './utils.js';
import type { BackgroundTasksSnapshot } from '@octopus/shared/protocol';
import type { ManagedSessionCommand } from './types.js';

/**
 * Starts a generation-bound barrier and exposes authoritative completion checks to the stop coordinator.
 */
export async function beginBackgroundStop(
  execute: (command: ManagedSessionCommand) => Promise<unknown>,
  read?: () => BackgroundTasksSnapshot | null | undefined
) {
  if (!read) {
    return undefined;
  }
  const catalog = responseData<{ commands?: { name: string; source: string }[] }>(
    await execute({ type: 'get_commands' })
  );
  const available = catalog?.commands?.some(
    (command) => command.name === BACKGROUND_COMMAND && command.source === 'extension'
  );
  if (!available) {
    if (read() !== undefined) {
      throw new Error('Background task control unavailable.');
    }
    return undefined;
  }
  await execute({ type: 'prompt', message: `/${BACKGROUND_COMMAND} status` });
  const initial = read();
  if (!initial) {
    throw new Error('Background task snapshot unavailable or invalid.');
  }
  const stopId = randomUUID();
  const response = await execute({ type: 'prompt', message: `/${BACKGROUND_COMMAND} begin ${stopId}` });
  if (!responseSucceeded(response)) {
    throw new Error('Background task stop rejected.');
  }
  /**
   * Rejects stale identities and invalid observations; incomplete work simply remains pending.
   */
  function current(): BackgroundTasksSnapshot {
    const snapshot = read!();
    if (
      !snapshot ||
      snapshot.generation !== initial!.generation ||
      snapshot.revision <= initial!.revision ||
      snapshot.stopId !== stopId
    ) {
      throw new Error('Background stop evidence is missing or stale.');
    }
    return snapshot;
  }
  return {
    /**
     * Only a closed admission gate and empty owned scope prove completion.
     */
    complete(): boolean {
      const snapshot = current();
      return !snapshot.accepting && snapshot.activeCount === 0;
    },
    /**
     * Reopens admission only after every other cancellation domain also settled.
     */
    async finish(): Promise<void> {
      const before = current();
      const response = await execute({ type: 'prompt', message: `/${BACKGROUND_COMMAND} finish ${stopId}` });
      const after = current();
      if (
        !responseSucceeded(response) ||
        !after.accepting ||
        after.activeCount !== 0 ||
        after.revision <= before.revision
      ) {
        throw new Error('Background stop barrier release was not confirmed.');
      }
    },
  };
}
