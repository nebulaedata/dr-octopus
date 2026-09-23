/**
 * @author Codex
 * @description Owns runtime replacement, frozen configuration and stop-priority lifecycle for every Server entrypoint.
 */
import { randomUUID } from 'node:crypto';
import { EnvironmentError } from '@octopus/env-loader';
import { loadServerConfig } from './infrastructure/config/config.js';
import { applyServerEnvironment, prepareServerEnvironment } from './infrastructure/config/environment.js';
import { ConfigurationQueue, controlError } from './infrastructure/lifecycle/control.js';
import { RestartHistory, within } from './infrastructure/lifecycle/operations.js';
import { isLoopbackHost } from './infrastructure/config/server-setting-fields.js';
import type { ServerHostOptions } from './infrastructure/lifecycle/host-options.js';
import type { ServerControl } from './infrastructure/lifecycle/control.js';
import type { ServerEnvironmentSnapshot } from './infrastructure/config/environment.js';
import type { ServerRuntime, ServerStatus } from './runtime.js';
import type { ServerConfig } from './infrastructure/config/utils.js';
import type { RestartOperationDto, RestartServerBody } from '@octopus/shared/protocol';

export type { ServerHostOptions } from './infrastructure/lifecycle/host-options.js';

/**
 * Provides a process-policy-free owner shared by standalone Server and CLI Gateway.
 */
export function createServerHost(options: ServerHostOptions = {}) {
  const queue = new ConfigurationQueue();
  const history = new RestartHistory();
  const prepare = options.prepare ?? prepareServerEnvironment;
  const apply = options.apply ?? applyServerEnvironment;
  const closeMs = options.closeTimeoutMs ?? 30_000;
  const startMs = options.startTimeoutMs;
  let state: ServerStatus['state'] = 'starting';
  let runtime: ServerRuntime | undefined;
  let candidate: ServerRuntime | undefined;
  let current: { environment: ServerEnvironmentSnapshot; config: ServerConfig; id: string };
  let stopRequested = false;
  let generation = 0;
  let active: RestartOperationDto | undefined;
  let starting: Promise<void> | undefined;
  let stopping: Promise<void> | undefined;

  /**
   * Fences late async completion and rejects new work as soon as restart is accepted.
   */
  function assertOpen(): void {
    if (state !== 'running' || stopRequested || active) {
      throw controlError('SERVER_RESTART_IN_PROGRESS', 'Server is restarting or stopping.');
    }
  }
  const listeners = new Set<() => void>();
  /**
   * Notifies the current HTTP instance after each Host-owned lifecycle transition.
   */
  function notify(): void {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        /* State queries remain authoritative. */
      }
    }
  }
  /**
   * Builds an instance-specific port; old HTTP requests cannot target a replacement implicitly.
   */
  function control(id: string, environment: ServerEnvironmentSnapshot): ServerControl {
    return {
      instanceId: id,
      currentEnvironment: environment,
      queue,
      assertOpen: () => {
        assertOpen();
        if (current.id !== id) {
          throw controlError(
            'SERVER_INSTANCE_CHANGED',
            'Server instance changed. Refresh before making changes.'
          );
        }
      },
      state: () => {
        if (stopRequested) {
          return 'stopping';
        } else {
          if (state === 'failed') {
            return 'failed';
          } else {
            if (active) {
              return 'restarting';
            } else {
              return 'running';
            }
          }
        }
      },
      restart: accept,
      operation: (operationId) => history.get(operationId),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
  }
  /**
   * Prevents any late start from publishing ready after a stop request.
   */
  function assertGeneration(expected: number): void {
    if (stopRequested || expected !== generation) {
      throw new Error('Host stopped');
    }
  }
  /**
   * Closes the only candidate before any recovery or replacement can be attempted.
   */
  async function closeCandidate(): Promise<void> {
    if (candidate) {
      await within(candidate.close(), closeMs, () => 'Server candidate cleanup');
      candidate = undefined;
    }
  }
  /**
   * Starts a frozen generation; cleanup remains the caller's responsibility on failure.
   */
  async function launch(
    snapshot: ServerEnvironmentSnapshot,
    config: ServerConfig,
    epoch: number
  ): Promise<string> {
    assertGeneration(epoch);
    Object.freeze(config.corsOrigins);
    Object.freeze(config.fileLogging);
    Object.freeze(config.paths);
    Object.freeze(config);
    apply(snapshot);
    const id = randomUUID();
    const factory = options.createRuntime ?? (await import('./runtime.js')).createServerRuntime;
    assertGeneration(epoch);
    const launching = factory({ config, control: control(id, snapshot) });
    candidate = launching;
    if (startMs === undefined) {
      await launching.start();
    } else {
      await within(
        launching.start(),
        startMs,
        () => `Server startup (phase: ${launching.getStatus().phase})`
      );
    }
    assertGeneration(epoch);
    runtime = candidate;
    candidate = undefined;
    current = { environment: snapshot, config, id };
    state = 'running';
    return id;
  }
  /**
   * Completes public state without allowing a late result to overwrite cancellation.
   */
  function finish(operation: RestartOperationDto, result: RestartOperationDto['state']): void {
    if (operation.state === 'cancelled') {
      return;
    }
    operation.state = result;
    operation.completedAt = new Date().toISOString();
    operation.actualAddress =
      result === 'succeeded' || result === 'restored' ? (runtime?.getStatus().address ?? null) : null;
    active = undefined;
    notify();
  }
  /**
   * Releases old resources, applies the target, then attempts at most one clean recovery.
   */
  async function replace(
    operation: RestartOperationDto,
    target: ServerEnvironmentSnapshot,
    config: ServerConfig,
    epoch: number
  ): Promise<void> {
    const previous = current;
    let candidateCleanupAttempted = false;
    try {
      assertGeneration(epoch);
      operation.state = 'draining';
      notify();
      await within(runtime!.close(), closeMs, () => 'Server restart shutdown');
      runtime = undefined;
      assertGeneration(epoch);
      operation.state = 'starting';
      notify();
      try {
        operation.targetInstanceId = await launch(target, config, epoch);
        finish(operation, 'succeeded');
      } catch {
        candidateCleanupAttempted = true;
        await closeCandidate();
        assertGeneration(epoch);
        operation.state = 'restoring';
        notify();
        candidateCleanupAttempted = false;
        operation.error = {
          code: 'SERVER_RESTART_APPLY_FAILED',
          message: 'New configuration failed; the previous configuration was restored.',
        };
        operation.targetInstanceId = await launch(previous.environment, previous.config, epoch);
        finish(operation, 'restored');
      }
    } catch {
      try {
        if (!candidateCleanupAttempted) {
          await closeCandidate();
        }
      } catch {
        /* Retain the candidate so stop can retry cleanup. */
      }
      if (!stopRequested) {
        state = 'failed';
        operation.error = {
          code: 'SERVER_RESTART_FAILED',
          message: 'Server could not restart safely. Use the Host stop/start controls.',
        };
        finish(operation, 'failed');
        options.onFailure?.();
      }
    }
  }
  /**
   * Reserves a target under the configuration queue; response handoff runs outside it.
   */
  async function accept(body: RestartServerBody, key: string) {
    return queue.run(() => {
      const known = history.find(key, body);
      if (known) {
        return { operation: structuredClone(known.operation), handoff: known.handoff };
      }
      assertOpen();
      if (body.expectedServiceInstanceId !== current.id) {
        throw controlError('SERVER_INSTANCE_CHANGED', 'Server instance changed. Refresh before restarting.');
      }
      history.assertCapacity();
      let target: ServerEnvironmentSnapshot;
      try {
        target = prepare();
      } catch (error) {
        if (error instanceof EnvironmentError) {
          throw controlError(error.code, error.message, error.code === 'ENV_IO' ? 500 : 400);
        }
        throw error;
      }
      if (target.revision !== body.revision) {
        throw controlError('ENV_CONFLICT', 'Configuration changed. Refresh before restarting.');
      }
      const config = loadServerConfig(target.values);
      const operation: RestartOperationDto = {
        operationId: randomUUID(),
        state: 'accepted',
        sourceInstanceId: current.id,
        targetInstanceId: null,
        targetRevision: target.revision,
        actualAddress: null,
        acceptedAt: new Date().toISOString(),
        completedAt: null,
        error: null,
        access: {
          kind: restartOriginKind(config, current.config),
          port: config.port,
          loopbackUrl: `http://127.0.0.1:${config.port}`,
        },
      };
      active = operation;
      state = 'starting';
      const epoch = ++generation;
      let released = false;
      /**
       * Transfers response ownership once, including client disconnect and timeout fallback.
       */
      const handoff = () => {
        if (released) {
          return;
        }
        released = true;
        clearTimeout(timer);
        void replace(operation, target, config, epoch);
      };
      const timer = setTimeout(handoff, 250);
      timer.unref();
      history.add(key, { body: { ...body }, operation, handoff });
      return { operation: structuredClone(operation), handoff };
    });
  }
  return {
    /**
     * Starts the initial generation exactly once.
     */
    start(): Promise<void> {
      return (starting ??= (async () => {
        try {
          const snapshot = prepare();
          await launch(snapshot, loadServerConfig(snapshot.values), generation);
        } catch (error) {
          if (!stopRequested) {
            state = 'failed';
          }
          await closeCandidate();
          throw error;
        }
      })());
    },
    /**
     * Sets stop priority synchronously before waiting for any asynchronous cleanup.
     */
    stop(): Promise<void> {
      if (stopping) {
        return stopping;
      }
      stopRequested = true;
      generation++;
      state = 'stopping';
      if (active) {
        active.state = 'cancelled';
        active.completedAt = new Date().toISOString();
        active = undefined;
      }
      return (stopping = (async () => {
        await Promise.all([runtime?.close(), candidate?.close()]);
        runtime = undefined;
        candidate = undefined;
        state = 'stopped';
      })());
    },
    /**
     * Keeps Gateway diagnostics available while the HTTP runtime is unavailable.
     */
    getStatus(): ServerStatus {
      const status = runtime?.getStatus() ?? candidate?.getStatus();
      return {
        ...(status ?? {
          phase: 'bootstrap',
          dataDir: '',
          fileLogging: { enabled: false, state: 'stopped', directory: '' },
          warnings: [],
        }),
        state,
        ...(state === 'failed'
          ? { warnings: ['Server restart failed. Use the Host stop/start controls.'] }
          : {}),
      };
    },
  };
}

/**
 * Preserves the ordered restartOriginKind selection rules.
 */
function restartOriginKind(
  config: ServerConfig,
  previous: ServerConfig
): 'local_only' | 'port_changed' | 'same_origin' {
  if (isLoopbackHost(config.host) && !isLoopbackHost(previous.host)) {
    return 'local_only';
  } else {
    if (config.port !== previous.port) {
      return 'port_changed';
    } else {
      return 'same_origin';
    }
  }
}
