/**
 * @author Codex
 * @description Performs read-only environment and release diagnostics without launching services or model requests.
 */
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { createConnection } from 'node:net';
import { getGatewayStatus } from './gateway/index.js';
import { dataDirectory, releaseRoot } from './paths.js';
import { readRelease, verifyDependencies } from './dependencies.js';
import { execute } from './process.js';
import { distribution } from './distribution/location.js';
import { runtimePnpm } from './distribution/pnpm.js';
import {
  resolveServerPort,
  resolveServerHost,
  resolveServerLogLevel,
  resolveServerFileLoggingConfig,
  resolveCorsOrigins,
  resolveHttpBodyLimitBytes,
  resolveAttachmentLimitBytes,
  resolveMaxActiveRuntimes,
  resolveMaxActiveRuntimesPerWorkspace,
  createServerEnvironmentStore,
} from '@octopus/server/config';

/**
 * Checks the nearest existing ancestor without creating a diagnostic directory or file.
 */
async function writable(path: string): Promise<string> {
  let existing = path;
  while (true) {
    try {
      await stat(existing);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      const parent = dirname(existing);
      if (parent === existing) {
        throw error;
      }
      existing = parent;
    }
  }
  await access(existing, constants.W_OK);
  return path;
}

/**
 * Checks TCP reachability without acquiring a listener or altering an existing service.
 */
async function portAvailable(host: string, port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    socket.setTimeout(1000, () => socket.destroy(new Error('Port check timed out')));
    socket.once('connect', () => {
      socket.destroy();
      resolve('occupied');
    });
    socket.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ECONNREFUSED') {
        resolve('available');
      } else {
        reject(error);
      }
    });
  });
}

/**
 * Reports independent checks; missing Git and missing dependencies do not prevent other diagnoses.
 */
export async function doctor() {
  const checks: { name: string; ok: boolean; detail: unknown }[] = [];
  const probes: Record<string, () => unknown> = {
    node: () => {
      const [major, minor] = process.versions.node.split('.').map(Number);
      if (major! < 22 || (major === 22 && minor! < 19)) {
        throw new Error('Node 22.19+ required');
      }
      return { version: process.version, path: process.execPath };
    },
    git: async () => ({
      version: await execute('git', ['--version'], distribution().root),
      path: await execute(process.platform === 'win32' ? 'where.exe' : 'which', ['git'], distribution().root),
    }),
    configuration: () => {
      const env = createServerEnvironmentStore(dataDirectory(process.env['SERVER_DATA_DIR'], 'server')).load()
        .values;
      return {
        host: resolveServerHost(env['SERVER_HOST']),
        port: resolveServerPort(env['SERVER_PORT']),
        fileLogging: resolveServerFileLoggingConfig(env, resolveServerLogLevel(env['LOG_LEVEL'])),
        corsOrigins: resolveCorsOrigins(env['SERVER_CORS_ORIGIN']),
        httpBodyLimitBytes: resolveHttpBodyLimitBytes(env['SERVER_HTTP_BODY_LIMIT_BYTES']),
        attachmentLimitBytes: resolveAttachmentLimitBytes(env['SERVER_ATTACHMENT_LIMIT_BYTES']),
        maxActiveRuntimes: resolveMaxActiveRuntimes(env['SERVER_MAX_ACTIVE_RUNTIMES']),
        maxActiveRuntimesPerWorkspace: resolveMaxActiveRuntimesPerWorkspace(
          env['SERVER_MAX_ACTIVE_RUNTIMES_PER_WORKSPACE']
        ),
      };
    },
    dataDirectory: async () => writable(dataDirectory(process.env['SERVER_DATA_DIR'], 'server')),
    logDirectory: async () => writable(join(dataDirectory(process.env['SERVER_DATA_DIR'], 'server'), 'logs')),
    release: async () => {
      await readRelease();
      return releaseRoot();
    },
    dependencies: async () => {
      await verifyDependencies();
      return 'Runtime and native modules load';
    },
    pnpm: async () => runtimePnpm(),
    gateway: async () => (await getGatewayStatus()) ?? { state: 'stopped' },
    port: async () => {
      const env = createServerEnvironmentStore(dataDirectory(process.env['SERVER_DATA_DIR'], 'server')).load()
        .values;
      return portAvailable(resolveServerHost(env['SERVER_HOST']), resolveServerPort(env['SERVER_PORT']));
    },
  };
  for (const [name, probe] of Object.entries(probes)) {
    try {
      checks.push({ name, ok: true, detail: await probe() });
    } catch (error) {
      checks.push({ name, ok: false, detail: String(error) });
    }
  }
  return {
    healthy: checks.every((check) => check.ok),
    checks,
    extensions: 'not-probed',
    models: 'not-probed',
  };
}
