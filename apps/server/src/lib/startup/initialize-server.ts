/**
 * @author Codex
 * @description Initializes Server resources and diagnostics before accepting HTTP requests.
 */
import { installBundledInfra, isBundledInfraInstalled } from '@octopus/agent';
import { initializeExtensions } from './extension-initialization.js';
import { createServerReadyMessage } from '../logging/server-ready-logger.js';
import { hasErrorCode } from '../../utils/index.js';
import type { FastifyInstance } from 'fastify';
import type { ServerConfig } from '../config/utils.js';
import type { ServerStatus } from '../../runtime-types.js';

/**
 * Performs initialization in order and checks cancellation before each new startup stage.
 * Errors are logged and propagated to the lifecycle owner for cleanup.
 */
export async function initializeServer(
  server: FastifyInstance,
  config: ServerConfig,
  status: ServerStatus,
  signal: AbortSignal
): Promise<void> {
  const startedAt = performance.now();
  const { host, port } = config;
  try {
    signal.throwIfAborted();
    status.phase = 'infra';
    if (!(await isBundledInfraInstalled())) {
      signal.throwIfAborted();
      server.log.info({ phase: 'infra' }, 'Missing Agent infrastructure detected, installing...');
      await installBundledInfra();
    }
    signal.throwIfAborted();
    status.phase = 'extensions';
    server.log.info({ phase: 'extensions' }, 'Checking for missing Pi extensions...');
    const result = await initializeExtensions(config.agentDir, signal);
    if (result.installed.length > 0) {
      server.log.info(
        { extensions: result.installed, phase: 'extensions' },
        'Missing Pi extensions installed'
      );
    }
    if (result.failures.length > 0) {
      throw new Error(
        `Pi extension installation failed: ${result.failures
          .map((failure) => `${failure.source}: ${String(failure.error)}`)
          .join('; ')}`
      );
    }
    signal.throwIfAborted();
    status.phase = 'listen';
    await server.listen({ host, port });
    signal.throwIfAborted();
    status.address = server.listeningOrigin;
    status.phase = 'ready';
    status.state = 'running';
    const logging = server.logging.getHealth();
    if (logging.state === 'degraded') {
      status.warnings.push(`File logging degraded: ${logging.errorCode ?? 'unknown'}`);
    }
    const readyMessage =
      config.environment === 'production'
        ? 'Dr.Octopus server is ready'
        : createServerReadyMessage({
            host,
            port,
            localUrl: server.listeningOrigin,
            readyInMs: performance.now() - startedAt,
          });
    server.log.info({ phase: 'ready' }, readyMessage);
  } catch (error) {
    if (!signal.aborted) {
      server.log.error(
        { err: error, host, port, phase: 'startup' },
        hasErrorCode(error, 'EADDRINUSE')
          ? `Port ${String(port)} is already in use.`
          : 'Dr.Octopus server failed to start'
      );
    }
    throw error;
  }
}
