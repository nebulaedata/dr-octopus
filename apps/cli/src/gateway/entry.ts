/**
 * @author Codex
 * @description Owns the Gateway process and adapts the public Server lifecycle to local management requests.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { acquireGateway } from './owner.js';
import { initializeServerEnvironment } from '@octopus/server/config';
import type * as ServerModule from '@octopus/server';
import type * as ServerHostModule from '@octopus/server/host';

let runtime: ReturnType<typeof ServerHostModule.createServerHost> | undefined;
let stopping = false;
const owner = await acquireGateway(fileURLToPath(import.meta.url), '0.0.0', (force) => {
  if (force) {
    process.exit(1);
  }
  void shutdown();
});
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

owner.refresh = () => {
  if (!runtime) {
    return;
  }
  const status = runtime.getStatus();
  if (!stopping) {
    owner.status.state = status.state === 'stopped' ? 'stopping' : status.state;
  }
  owner.status.phase = status.phase;
  owner.status.address = status.address;
  owner.status.dataDir = status.dataDir;
  owner.status.fileLogging = status.fileLogging;
  owner.status.warnings = status.warnings;
};

const initialization = initialize();
try {
  await initialization;
} catch (error) {
  if (!stopping) {
    console.error(error);
    await shutdown(1);
  }
}

/**
 * Loads Server only after the Gateway lease is held, preserving lightweight management commands.
 */
async function initialize(): Promise<void> {
  initializeServerEnvironment();
  const developmentEntry = process.argv[2];
  const { createServerRuntime } = developmentEntry
    ? ((await import(pathToFileURL(developmentEntry).href)) as typeof ServerModule)
    : await import('@octopus/server');
  if (stopping) {
    return;
  }
  const { createServerHost } = await import('@octopus/server/host');
  if (stopping) {
    return;
  }
  runtime = createServerHost({ createRuntime: createServerRuntime });
  owner.refresh();
  await runtime.start();
  if (!stopping) {
    owner.status.state = 'running';
    owner.refresh();
  }
}

/**
 * Closes the Server before releasing discovery and the lease; the process owns the deadline and exit code.
 */
async function shutdown(exitCode = 0): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;
  owner.status.state = 'stopping';
  const deadline = setTimeout(() => process.exit(1), 30_000);
  deadline.unref();
  try {
    await runtime?.stop();
    await initialization.catch(() => undefined);
    await owner.close();
    process.exit(exitCode);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
