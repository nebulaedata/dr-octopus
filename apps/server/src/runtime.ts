/**
 * @author Codex
 * @description Exposes the Server lifecycle independently of command-line and process management policies.
 */
import { createServer } from './app.js';
import { loadServerConfig } from './lib/config/config.js';
import { initializeServer } from './lib/startup/initialize-server.js';
import type { ServerConfig } from './lib/config/utils.js';
import type { ServerRuntime, ServerStatus } from './runtime-types.js';
import type { ServerControl } from './lib/lifecycle/control.js';

export type { ServerRuntime, ServerStatus } from './runtime-types.js';

/**
 * Creates a service without listening, acquiring process locks, or installing signal handlers.
 * The caller owns process lifetime and must close the service when finished.
 *
 * @param options Optional resolved Server configuration; defaults to the current environment.
 */
export function createServerRuntime(
  options: { config?: ServerConfig; control?: ServerControl } = {}
): ServerRuntime {
  const config = options.config ?? loadServerConfig();
  const server = createServer({ config, ...(options.control ? { control: options.control } : {}) });
  const abort = new AbortController();
  const status: ServerStatus = {
    state: 'starting',
    phase: 'bootstrap',
    dataDir: config.paths.dataDir,
    fileLogging: {
      enabled: config.fileLogging.enabled,
      state: 'starting',
      directory: config.paths.logsRoot,
    },
    warnings: [],
  };
  let starting: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  let resourceClose: Promise<void> | undefined;

  /**
   * Shares cleanup between startup failure and explicit shutdown.
   */
  function closeResources(): Promise<void> {
    return (resourceClose ??= server.close());
  }

  return {
    /**
     * Starts the service once; a closed runtime cannot be restarted.
     */
    start(): Promise<void> {
      if (abort.signal.aborted) {
        return Promise.reject(new Error('Server runtime is closed'));
      }
      return (starting ??= initializeServer(server, config, status, abort.signal).catch(
        async (error: unknown) => {
          if (!abort.signal.aborted) {
            status.state = 'failed';
          }
          try {
            await closeResources();
          } catch (cleanupError) {
            throw new AggregateError([error, cleanupError], 'Server startup and cleanup failed', {
              cause: cleanupError,
            });
          }
          throw error;
        }
      ));
    },
    /**
     * Cancels initialization before waiting, so an active installer can be reclaimed.
     */
    close(): Promise<void> {
      return (closing ??= (async () => {
        status.state = 'stopping';
        abort.abort();
        await starting?.catch(() => undefined);
        try {
          await closeResources();
          status.state = 'stopped';
        } catch (error) {
          status.state = 'failed';
          throw error;
        }
      })());
    },
    /**
     * Refreshes logging health and copies mutable values for callers.
     */
    getStatus(): ServerStatus {
      return {
        ...status,
        fileLogging: { ...status.fileLogging, state: server.logging.getHealth().state },
        warnings: [...status.warnings],
      };
    },
  };
}
