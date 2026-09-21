/**
 * @author Codex
 * @description Coordinates fenced main-Agent and detached subagent cancellation without owning Pi process state.
 */
import { setTimeout as delay } from 'node:timers/promises';
import { SessionRuntimeError } from './errors.js';
import { waitForRuntime } from './deadline.js';
import { beginBackgroundStop } from './stop-background.js';
import { responseData, responseSucceeded } from './utils.js';
import type { BackgroundTasksSnapshot } from '@octopus/shared/protocol';
import type { SubagentFleetNodeDto, SubagentFleetSnapshotDto } from '@octopus/shared/protocol';
import type { ManagedSessionCommand } from './types.js';
import type { SessionRuntimeOperation } from './operation.js';
import type { RpcSessionState } from '@earendil-works/pi-coding-agent';

export interface StopSessionOptions {
  /**
   * Reads the latest authoritative fleet projection for the acquired Session generation.
   */
  readFleet(): SubagentFleetSnapshotDto | undefined;
  /**
   * Returns null for invalid matching snapshots, which must not prove a successful stop.
   */
  readBackground?: () => BackgroundTasksSnapshot | null | undefined;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

/**
 * Aborts the main loop and stops its detached roots, including roots published while abort was settling.
 * An acknowledgement alone never counts as proof that an observed background task stopped.
 * The caller owns the runtime lease and deduplicates concurrent stop requests.
 */
export async function stopSession(
  target: Pick<SessionRuntimeOperation, 'execute'>,
  options: StopSessionOptions
): Promise<unknown> {
  const deadline = Date.now() + (options.timeoutMs ?? 15_000);
  const requested = new Set<string>();
  const captured = new Set<string>();
  let captureComplete = false;
  const problems: string[] = [];
  let commandsChecked = false;
  let mainDone = false;
  let mainResponse: unknown;
  /**
   * Freezes the final cancellation scope at the abort response, before later user work can publish roots.
   */
  function finishMain(): void {
    for (const run of options.readFleet()?.runs.filter(hasActiveWork) ?? []) {
      captured.add(run.id);
    }
    captureComplete = true;
    mainDone = true;
  }
  /**
   * Bounds each transport wait by the same stop deadline without cancelling shared runtime work.
   */
  const execute = (command: ManagedSessionCommand): Promise<unknown> =>
    waitForRuntime(
      target.execute(command),
      { deadlineAt: deadline },
      options.timeoutMs ?? 15_000,
      Date.now,
      'stop'
    );
  // Send abort immediately; waiting for background work must never prevent main-loop cancellation.
  void execute({ type: 'abort' }).then(
    (response) => {
      mainResponse = response;
      if (!responseSucceeded(response)) {
        problems.push('Pi rejected the main Agent abort.');
      }
      finishMain();
    },
    (error: unknown) => {
      problems.push(error instanceof Error ? error.message : String(error));
      finishMain();
    }
  );
  let background: Awaited<ReturnType<typeof beginBackgroundStop>>;
  let backgroundReady = false;
  // Background discovery must not gate cancellation of independently controlled subagents.
  const backgroundPromise = beginBackgroundStop(execute, options.readBackground)
    .then(
      (control) => {
        background = control;
      },
      (error: unknown) => {
        problems.push(error instanceof Error ? error.message : String(error));
      }
    )
    .finally(() => {
      backgroundReady = true;
    });
  try {
    // Pi abort leaves steering/follow-up messages queued; they would keep the Host busy indefinitely.
    // Dispatch without waiting for abort, so queued continuations cannot survive cancellation.
    const cleared = await execute({ type: 'clear_queue' });
    if (!responseSucceeded(cleared)) {
      throw new Error('Pi rejected clearing queued messages.');
    }
    while (Date.now() < deadline) {
      // This read is fenced by the acquired operation and detects generation replacement during polling.
      const state = await execute({ type: 'get_state' });
      if (!responseSucceeded(state)) {
        throw new Error('Cannot verify the stopped runtime.');
      }
      const fleet = options.readFleet();
      if (fleet?.omitted.runs || fleet?.omitted.children || fleet?.omitted.byteLimitExceeded) {
        throw new Error('The background task snapshot is incomplete; cannot confirm all tasks stopped.');
      }
      const live = fleet?.runs.filter(hasActiveWork) ?? [];
      if (!captureComplete) {
        for (const run of live) {
          captured.add(run.id);
        }
        captureComplete = mainDone;
      }
      const active = live.filter((run) => captured.has(run.id));
      for (const run of active) {
        if (requested.has(run.id)) {
          continue;
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(run.id)) {
          throw new Error('Invalid background task identity.');
        }
        if (!commandsChecked) {
          const catalog = responseData<{ commands?: { name: string; source: string }[] }>(
            await execute({ type: 'get_commands' })
          );
          if (
            !catalog?.commands?.some(
              (command) => command.name === 'subagents-stop' && command.source === 'extension'
            )
          ) {
            throw new Error('The subagents-stop extension command is unavailable.');
          }
          commandsChecked = true;
        }
        const response = await execute({ type: 'prompt', message: `/subagents-stop ${run.id}` });
        if (!responseSucceeded(response)) {
          throw new Error(`Stop request rejected for background task ${run.id}.`);
        }
        requested.add(run.id);
      }
      const mainState = responseData<RpcSessionState>(state);
      const mainIdle =
        mainState?.isStreaming === false &&
        mainState.isCompacting === false &&
        mainState.pendingMessageCount === 0;
      if (
        mainDone &&
        mainIdle &&
        active.length === 0 &&
        backgroundReady &&
        (background?.complete() ?? true)
      ) {
        if (problems.length > 0) {
          throw new Error(problems[0]);
        }
        await background?.finish();
        return mainResponse;
      }
      const poll = delay(options.pollIntervalMs ?? 100);
      await (backgroundReady ? poll : Promise.race([poll, backgroundPromise]));
    }
    throw new Error('Timed out waiting for the main Agent and background tasks to stop.');
  } catch (error) {
    // Retain the operation lease until the already-started background cancellation attempt settles.
    await backgroundPromise;
    const messages = [...new Set([...problems, error instanceof Error ? error.message : String(error)])];
    throw new SessionRuntimeError(
      'SESSION_RUNTIME_STALE',
      `Stop could not be confirmed: ${messages.join(' ')}`,
      error
    );
  }
}

/**
 * Includes running descendants even when their root has entered a terminal-looking intermediate state.
 */
function hasActiveWork(run: SubagentFleetNodeDto): boolean {
  return run.state === 'running' || run.state === 'queued' || (run.children?.some(hasActiveWork) ?? false);
}
