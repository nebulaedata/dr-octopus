/**
 * @author Codex
 * @description Manages one authenticated Gateway process while preserving the independent Scheduler lifecycle.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { access, mkdir, open } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  getGatewayStatus,
  readGatewayIdentity,
  requestGateway,
  gatewayError,
  gatewayPaths,
  isProcessAlive,
} from './gateway/index.js';
import { ensureDependencies } from './dependencies.js';
import { installLockPath } from './distribution/install-lock.js';
import { releaseRoot, releasePaths } from './paths.js';
import { progress } from './output.js';
import { dataDirectory } from './paths.js';
import {
  resolveServerFileLoggingConfig,
  resolveServerLogLevel,
  resolveServerPort,
  createServerEnvironmentStore,
} from '@octopus/server/config';
import type { GatewayStatus } from './gateway/index.js';
import type { DependencyOptions } from './dependencies.js';

export interface GatewayOptions extends DependencyOptions {
  fileLog?: boolean;
  devEntry?: string;
  inspect?: string;
  timeout: number;
}

/**
 * Applies explicit option, environment, restart state, then Server default in that order.
 */
export function fileLogValue(
  option: boolean | undefined,
  env: NodeJS.ProcessEnv,
  previous?: boolean
): string {
  if (option !== undefined) {
    return String(option);
  }
  return env['SERVER_FILE_LOG_ENABLED']?.trim() || String(previous ?? false);
}

/**
 * Validates launch configuration and installed assets before a restart stops the current service.
 */
export async function preflightGateway(
  options: GatewayOptions,
  previous?: GatewayStatus | null
): Promise<void> {
  if (!options.devEntry) {
    try {
      await access(installLockPath(releaseRoot()));
      throw gatewayError(
        'INSTALL_IN_PROGRESS',
        'Dependency installation is in progress. Retry after it finishes.'
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
  const snapshot = createServerEnvironmentStore(
    dataDirectory(process.env['SERVER_DATA_DIR'], 'server')
  ).load();
  const configured = { ...snapshot.persisted, ...process.env };
  const env: NodeJS.ProcessEnv = {
    ...snapshot.values,
    SERVER_FILE_LOG_ENABLED: fileLogValue(options.fileLog, configured, previous?.fileLogging?.enabled),
  };
  resolveServerFileLoggingConfig(env, resolveServerLogLevel(env['LOG_LEVEL']));
  resolveServerPort(env['SERVER_PORT']);
  dataDirectory(process.env['SERVER_DATA_DIR'], 'server');
  dataDirectory(process.env['DR_OCTOPUS_CODING_AGENT_DIR'], 'agent');
  if (!options.devEntry) {
    await ensureDependencies(options);
  }
  await access(options.devEntry ?? releasePaths().serverEntry);
}

/**
 * Queries both HTTP probes only after authenticating the owning local process.
 */
export async function healthGateway(status?: GatewayStatus | null) {
  const current = status ?? (await getGatewayStatus());
  if (current?.state !== 'running' || !current.address) {
    throw gatewayError('GATEWAY_NOT_READY', 'Gateway is not running.');
  }
  const probes = await Promise.all(
    ['health', 'ready'].map(async (name) => {
      const url = new URL(`/api/${name}`, current.address);
      if (url.hostname === '0.0.0.0') {
        url.hostname = '127.0.0.1';
      }
      if (url.hostname === '[::]') {
        url.hostname = '[::1]';
      }
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      const result: unknown = await response.json();
      if (!response.ok) {
        throw gatewayError('GATEWAY_NOT_READY', `${name}: ${JSON.stringify(result)}`);
      }
      return [name, result] as const;
    })
  );
  return { ...Object.fromEntries(probes), extensions: 'not-probed', models: 'not-probed' };
}

/**
 * Stops only the authenticated instance, then waits for its process to exit before allowing restart.
 */
export async function stopGateway(timeout = 40_000): Promise<{ state: 'stopped' }> {
  const current = await getGatewayStatus();
  if (!current) {
    return { state: 'stopped' };
  }
  const identity = await readGatewayIdentity();
  if (!identity || identity.instanceId !== current.instanceId) {
    throw gatewayError('GATEWAY_IDENTITY_UNVERIFIED', 'Gateway changed during stop; retry.');
  }
  await requestGateway(identity, 'stop');
  const deadline = Date.now() + timeout;
  while (isProcessAlive(identity.pid)) {
    if (Date.now() >= deadline) {
      // The process itself performs forced exit, never an unverified or reused PID.
      await requestGateway(identity, 'force');
      await delay(500);
      if (isProcessAlive(identity.pid)) {
        throw gatewayError(
          'GATEWAY_STOP_TIMEOUT',
          'Gateway did not exit after authenticated forced shutdown.'
        );
      }
      break;
    }
    await delay(100);
  }
  return { state: 'stopped' };
}

/**
 * Launches Node directly, with no watcher IPC, and succeeds only after authenticated readiness.
 */
export async function startGateway(
  options: GatewayOptions,
  foreground: boolean,
  previous?: GatewayStatus | null
) {
  if (await getGatewayStatus()) {
    throw gatewayError('GATEWAY_ALREADY_RUNNING', 'Gateway is already starting, running or stopping.');
  }
  const entry = options.devEntry
    ? fileURLToPath(
        new URL(import.meta.url.endsWith('.ts') ? './gateway/entry.ts' : './gateway.mjs', import.meta.url)
      )
    : releasePaths().gatewayEntry;
  if (options.devEntry && !isAbsolute(options.devEntry)) {
    throw new Error('--dev-entry must be an absolute path.');
  }
  if (options.devEntry && !foreground) {
    throw new Error('Development entry requires gateway run.');
  }
  await preflightGateway(options, previous);
  await access(entry);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
  };
  const snapshot = createServerEnvironmentStore(dataDirectory(env['SERVER_DATA_DIR'], 'server')).load();
  // Persisted/default values stay in Server's configuration snapshot, never in Agent's inherited env.
  if (options.fileLog !== undefined) {
    env['SERVER_FILE_LOG_ENABLED'] = String(options.fileLog);
  } else if (
    env['SERVER_FILE_LOG_ENABLED'] === undefined &&
    snapshot.persisted.SERVER_FILE_LOG_ENABLED === undefined &&
    previous
  ) {
    env['SERVER_FILE_LOG_ENABLED'] = String(previous.fileLogging?.enabled ?? false);
  }
  delete env['NODE_CHANNEL_FD'];
  delete env['NODE_CHANNEL_SERIALIZATION_MODE'];
  delete env['NODE_OPTIONS'];
  if (!options.devEntry) {
    env['SERVER_WEB_ROOT'] = releasePaths().webClient;
  }
  const args = ['--enable-source-maps'];
  if (options.inspect) {
    args.push(`--inspect=${options.inspect}`);
  }
  if (entry.endsWith('.ts') || options.devEntry?.endsWith('.ts')) {
    args.push('--import', 'tsx');
  }
  args.push(entry);
  if (options.devEntry) {
    args.push(resolve(options.devEntry));
  }
  const paths = gatewayPaths();
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  const output = foreground ? undefined : await open(join(paths.directory, 'launcher.log'), 'w', 0o600);
  const child = spawn(process.execPath, args, {
    cwd: options.devEntry ? dirname(entry) : releaseRoot(),
    env,
    detached: !foreground,
    windowsHide: true,
    stdio: ['ignore', output?.fd ?? 2, output?.fd ?? 2],
  });
  let launchError: Error | undefined;
  child.once('error', (error) => {
    launchError = error;
  });
  const finished = new Promise<number | null>((resolveExit) => child.once('close', resolveExit));
  await output?.close();
  const indicator = progress(options, 'Starting Gateway');
  const cancel = () => {
    void getGatewayStatus()
      .then(async (status) => {
        if (status?.pid === child.pid) {
          await stopGateway();
        } else {
          child.kill();
        }
      })
      .catch(() => child.kill());
  };
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    const deadline = Date.now() + options.timeout;
    let status: GatewayStatus | null = null;
    while (Date.now() < deadline) {
      if (launchError) {
        throw launchError;
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        throw gatewayError(
          'GATEWAY_START_FAILED',
          `Gateway exited (${String(child.exitCode)}). See ${join(paths.directory, 'launcher.log')}.`
        );
      }
      try {
        status = await getGatewayStatus();
      } catch (error) {
        const candidate = await readGatewayIdentity();
        if (candidate?.pid !== child.pid) {
          throw error;
        }
        // Synchronous bootstrap work can temporarily delay the owned process's control channel.
        // Keep its lock intact and wait within this launch's original startup deadline.
        await delay(150);
        continue;
      }
      if (status && status.pid !== child.pid) {
        throw gatewayError('GATEWAY_ALREADY_RUNNING', 'Another concurrent start acquired the Gateway.');
      }
      if (status) {
        indicator.message(`Gateway: ${status.phase}`);
      }
      if (status?.state === 'running') {
        await healthGateway(status);
        break;
      }
      await delay(150);
    }
    if (status?.state !== 'running') {
      throw gatewayError('GATEWAY_START_TIMEOUT', 'Gateway initialization timed out.');
    }
    indicator.stop('Gateway ready');
    for (const warning of status.warnings) {
      console.error(warning);
    }
    if (foreground) {
      const code = await finished;
      if (code !== 0) {
        throw gatewayError('GATEWAY_EXIT_FAILED', `Gateway exited with ${String(code)}.`);
      }
      return { state: 'stopped' };
    }
    child.unref();
    return status;
  } catch (error) {
    indicator.stop('Gateway startup failed');
    const status = await getGatewayStatus().catch(() => null);
    if (status?.pid === child.pid) {
      await stopGateway().catch(() => child.kill());
    } else {
      child.kill();
    }
    throw error;
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}
