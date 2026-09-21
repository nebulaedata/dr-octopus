/**
 * @author Codex
 * @description Subscribes to an existing Scheduler daemon with authenticated discovery and bounded reconnect.
 */
import { readFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { resolveSchedulerProfile, readMetadata } from '../infrastructure/profile.js';
import type { FSWatcher } from 'node:fs';
import type { SchedulerEndpoint } from '../definitions/service-lifecycle.js';

export interface SchedulerChangeEvent {
  type: 'ready' | 'change' | 'disconnected';
}

export interface SchedulerChangeSubscription {
  /**
   * Abort discovery, streaming reads and reconnect waits, then await resource cleanup.
   */
  close(): Promise<void>;
}

/**
 * Never start a daemon. A ready or lost connection tells the Host to reconcile authoritative state.
 * Listener failures are isolated from transport; callers own durable reconciliation and its retries.
 */
export function subscribeSchedulerChanges(
  agentDir: string,
  listener: (event: SchedulerChangeEvent) => void
): SchedulerChangeSubscription {
  const controller = new AbortController();
  let watcher: FSWatcher | undefined;
  let wake: AbortController | undefined;
  let activeAttempt: AbortController | undefined;
  /**
   * Keep application callbacks from breaking reconnection or producing unhandled rejections.
   */
  function notify(type: SchedulerChangeEvent['type'] = 'change'): void {
    if (controller.signal.aborted) {
      return;
    }
    try {
      listener({ type });
    } catch {
      /* The next ready event permits reconciliation. */
    }
  }
  /**
   * Rediscover identity after each failed stream with a bounded exponential delay.
   */
  async function run(): Promise<void> {
    let backoff = 1000;
    let connected = false;
    while (!controller.signal.aborted) {
      const attempt = new AbortController();
      activeAttempt = attempt;
      const signal = AbortSignal.any([controller.signal, attempt.signal]);
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      try {
        const profile = await resolveSchedulerProfile(agentDir, false);
        if (controller.signal.aborted) {
          break;
        }
        signal.throwIfAborted();
        if (!profile) {
          throw new Error('Scheduler profile unavailable');
        }
        if (!watcher) {
          try {
            watcher = watch(profile.directory, { persistent: false }, (_event, filename) => {
              const name = filename?.toString();
              if (!['endpoint.json', 'control.json', 'cron.json'].includes(name ?? '')) {
                return;
              }
              backoff = 1000;
              notify();
              if (name !== 'cron.json') {
                activeAttempt?.abort();
                wake?.abort();
              }
            });
            watcher.on('error', () => {
              watcher?.close();
              watcher = undefined;
            });
          } catch {
            /* Missing directory is retried without creating it. */
          }
        }
        const endpoint = await readMetadata<SchedulerEndpoint>(join(profile.directory, 'endpoint.json'));
        if (
          !endpoint ||
          endpoint.protocol !== 3 ||
          endpoint.profileId !== profile.profileId ||
          !Number.isInteger(endpoint.port) ||
          endpoint.port < 1 ||
          endpoint.port > 65535 ||
          typeof endpoint.daemonId !== 'string'
        ) {
          throw new Error('Scheduler discovery unavailable');
        }
        const token = await readFile(join(profile.directory, 'credentials', 'control-token'), 'utf8');
        watchdog = setTimeout(() => attempt.abort(), 5000);
        const response = await fetch(`http://127.0.0.1:${endpoint.port}/scheduler/v1/service/events`, {
          signal,
          redirect: 'error',
          headers: {
            authorization: 'Bearer ' + token,
            'x-scheduler-daemon': endpoint.daemonId,
            'x-scheduler-profile': endpoint.profileId,
          },
        });
        if (
          !response.ok ||
          !response.headers.get('content-type')?.startsWith('text/event-stream') ||
          !response.body
        ) {
          await response.body?.cancel();
          throw new Error('Scheduler stream unavailable');
        }
        const reader = response.body.getReader();
        let buffer = '';
        const decoder = new TextDecoder();
        try {
          for (;;) {
            clearTimeout(watchdog);
            watchdog = setTimeout(() => attempt.abort(), 45_000);
            const chunk = await reader.read();
            if (chunk.done) {
              break;
            }
            const bytes: unknown = chunk.value;
            if (!(bytes instanceof Uint8Array)) {
              throw new Error('Invalid Scheduler stream chunk');
            }
            buffer += decoder.decode(bytes, { stream: true });
            buffer = buffer.replace(/\r\n/g, '\n');
            if (buffer.length > 64 * 1024) {
              throw new Error('Scheduler frame too large');
            }
            let boundary: number;
            while ((boundary = buffer.indexOf('\n\n')) >= 0) {
              const frame = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              const event = /^event: (ready|change)$/m.exec(frame)?.[1];
              if (event === 'ready' || event === 'change') {
                connected = true;
                backoff = 1000;
                notify(event);
              }
            }
          }
        } finally {
          await reader.cancel().catch(() => undefined);
        }
      } catch {
        /* Discovery or stream failure is repaired by the next bounded attempt. */
      } finally {
        clearTimeout(watchdog);
        attempt.abort();
      }
      if (connected && !controller.signal.aborted) {
        connected = false;
        notify('disconnected');
      }
      if (!controller.signal.aborted) {
        wake = new AbortController();
        await delay(backoff, undefined, { signal: AbortSignal.any([controller.signal, wake.signal]) }).catch(
          () => undefined
        );
        backoff = Math.min(backoff * 2, 30_000);
      }
    }
  }
  const done = run();
  return {
    async close() {
      controller.abort();
      watcher?.close();
      await done;
      watcher?.close();
    },
  };
}
