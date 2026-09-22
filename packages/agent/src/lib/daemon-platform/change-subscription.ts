/**
 * @author Codex
 * @description Shares event-stream reconnect and native lifecycle discovery across local daemon SDKs.
 */
import { watch } from 'node:fs';
import { access } from 'node:fs/promises';
import { relative, sep, dirname } from 'node:path';
import type { FSWatcher } from 'node:fs';

export interface DaemonChangeSubscription {
  close(): Promise<void>;
}
export interface DaemonChangeSubscriptionOptions {
  directory: string;
  /**
   * Opens the identity-checked local stream, or returns null while the service is absent.
   */
  connect(signal: AbortSignal): Promise<Response | null>;
  /**
   * Invalidates the consumer's snapshot on ready, change, or disconnection.
   */
  onChange(): void;
  /**
   * Reports transport faults without converting them into business polling.
   */
  onError?(error: unknown): void;
}

/**
 * Watches discovery metadata and keeps one stream per subscriber; absent services are never started.
 */
export async function subscribeDaemonChanges(
  options: DaemonChangeSubscriptionOptions
): Promise<DaemonChangeSubscription> {
  let closed = false;
  let closing: Promise<void> | undefined;
  let watcher: FSWatcher | undefined;
  let controller: AbortController | undefined;
  let task: Promise<void> | undefined;
  let timer: NodeJS.Timeout | undefined;
  let attempt = 0;
  let connected = false;
  const metadata = new Set(['endpoint.json', 'control.json', 'startup-error.json', 'lifecycle.json']);
  /**
   * Publishes only an invalidation hint; caller failures cannot break transport cleanup.
   */
  function changed(): void {
    try {
      options.onChange();
    } catch {
      /* Next ready reconciles. */
    }
  }
  /**
   * Coalesces directory bursts and retries only a disconnected transport.
   */
  function schedule(delay = 50): void {
    if (closed) {
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      void connect();
    }, delay);
    timer.unref();
  }
  /**
   * Rebinds to the service directory when a previously absent parent is created.
   */
  async function observe(signal?: AbortSignal): Promise<void> {
    let directory = options.directory;
    while (true) {
      try {
        await access(directory);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
        const parent = dirname(directory);
        if (parent === directory) {
          throw error;
        }
        directory = parent;
      }
    }
    if (closed || signal?.aborted) {
      return;
    }
    watcher?.close();
    watcher = watch(directory, { persistent: false }, (_event, filename) => {
      if (
        filename === null ||
        (directory === options.directory
          ? metadata.has(filename.toString())
          : filename.toString() === relative(directory, options.directory).split(sep)[0])
      ) {
        changed();
        schedule();
      }
    });
    const observedWatcher = watcher;
    observedWatcher.once('close', () => {
      if (watcher === observedWatcher) {
        watcher = undefined;
      }
    });
    observedWatcher.on('error', (error) => {
      if (watcher === observedWatcher) {
        watcher = undefined;
      }
      observedWatcher.close();
      options.onError?.(error);
      schedule(1000);
    });
  }
  /**
   * Restores one stream after a real lifecycle event or transport disconnection.
   */
  async function connect(): Promise<void> {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    task = (async () => {
      let watchdog: NodeJS.Timeout | undefined;
      let stalled = false;
      /**
       * Heartbeats reset one deadline; expiry reconnects transport without requesting business state.
       */
      function alive(): void {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => {
          stalled = true;
          current.abort();
        }, 45000);
        watchdog.unref();
      }
      alive();
      try {
        await observe(current.signal);
        const response = await options.connect(current.signal);
        if (current.signal.aborted || closed) {
          return;
        }
        if (!response) {
          if (connected) {
            connected = false;
            changed();
          }
          return;
        }
        if (!response.ok || !response.body) {
          throw new Error('Daemon change stream is unavailable; restart the service after upgrading.');
        }
        attempt = 0;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
          while (!closed && !current.signal.aborted) {
            const next = await reader.read();
            if (next.done) {
              break;
            }
            alive();
            const bytes: unknown = next.value;
            if (!(bytes instanceof Uint8Array)) {
              throw new Error('Invalid daemon event bytes.');
            }
            buffer += decoder.decode(bytes, { stream: true });
            let end;
            while ((end = buffer.indexOf('\n\n')) >= 0) {
              if (end > 8192) {
                throw new Error('Invalid daemon event frame.');
              }
              const frame = buffer.slice(0, end);
              buffer = buffer.slice(end + 2);
              if (frame.startsWith('event: ready') || frame.startsWith('event: change')) {
                connected = true;
                changed();
              }
            }
            if (buffer.length > 8192) {
              throw new Error('Invalid daemon event frame.');
            }
          }
        } finally {
          await reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
      } catch (error) {
        if ((!current.signal.aborted || stalled) && !closed && controller === current) {
          options.onError?.(error);
        }
      } finally {
        clearTimeout(watchdog);
      }
      if ((!current.signal.aborted || stalled) && !closed && controller === current) {
        if (connected) {
          connected = false;
          changed();
        }
        schedule(Math.min(1000 * 2 ** attempt++, 30000));
      }
    })();
    await task;
  }
  await observe();
  void connect();
  return {
    /**
     * Stops watchers, reconnect attempts and stream reads owned by this subscription.
     */
    close() {
      return (closing ??= (async () => {
        closed = true;
        clearTimeout(timer);
        const closedWatcher = watcher
          ? new Promise<void>((resolve) => watcher!.once('close', resolve))
          : Promise.resolve();
        watcher?.close();
        controller?.abort();
        await Promise.all([closedWatcher, task]);
      })());
    },
  };
}
