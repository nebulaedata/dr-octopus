/**
 * @author Codex
 * @description Drains registered background process ownership before terminating the Pi RPC process.
 */
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { BACKGROUND_COMMAND } from '@octopus/shared/protocol';
import type { BackgroundTasksSnapshot } from '@octopus/shared/protocol';
import type { RpcCommand } from '@earendil-works/pi-coding-agent';

/**
 * Uses a command only after discovery, then verifies matching complete state before allowing teardown.
 */
export async function drainBackgroundTasks(
  execute: (command: RpcCommand) => Promise<unknown>,
  read: () => BackgroundTasksSnapshot | null | undefined
): Promise<void> {
  const initial = read();
  if (initial === undefined) {
    return;
  }
  if (initial === null) {
    throw new Error('Background ownership snapshot is invalid; cleanup unconfirmed.');
  }
  const catalog = (await execute({ type: 'get_commands' })) as {
    data?: { commands?: { name: string; source: string }[] };
  };
  if (
    !catalog.data?.commands?.some((item) => item.name === BACKGROUND_COMMAND && item.source === 'extension')
  ) {
    throw new Error('Background cleanup command unavailable.');
  }
  const stopId = randomUUID();
  await execute({ type: 'prompt', message: `/${BACKGROUND_COMMAND} begin ${stopId}` });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const snapshot = read();
    if (
      snapshot?.generation === initial.generation &&
      snapshot.stopId === stopId &&
      !snapshot.accepting &&
      snapshot.activeCount === 0
    ) {
      return;
    }
    await delay(50);
  }
  throw new Error('Background process cleanup timed out; runtime retained for retry.');
}
