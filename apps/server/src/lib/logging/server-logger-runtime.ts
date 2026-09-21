/**
 * @author Codex
 * @description Composes stdout and optional rolling-file logging with health and graceful shutdown ownership.
 */

import pino from 'pino';
import { join } from 'node:path';
import { clearActiveLogMarker, createFileLogTransport, preflightFileLogging } from './file-log-transport.js';
import { acquireFileLogLease } from './file-log-lease.js';
import { closeFileLogging, waitForTransportStartup } from './file-log-lifecycle.js';
import { LogRetentionManager } from './log-retention.js';
import {
  createServerLogOptions,
  createStdoutDestination,
  selectMostVerboseLevel,
} from './server-log-options.js';
import { sanitizeFileLogLine } from './file-log-sanitizer.js';
import type { DestinationStream } from 'pino';
import type { FastifyBaseLogger } from 'fastify';
import type { ServerFileLoggingConfig, ServerLogLevel } from '../config/utils.js';
import type { FileLogTransport } from './file-log-transport.js';
import type { FileLogLease } from './file-log-lease.js';
import type { FileLoggingHealth, ServerLoggerRuntime } from './logging.types.js';

declare module 'fastify' {
  interface FastifyInstance {
    logging: ServerLoggerRuntime;
  }
}

export interface CreateServerLoggerRuntimeOptions {
  level: ServerLogLevel;
  pretty: boolean;
  logsRoot: string;
  fileLogging: ServerFileLoggingConfig;
}

/**
 * Creates a stdout logger and conditionally attaches a guarded worker-backed file destination.
 *
 * @param options Validated logging configuration and canonical Server path.
 * @returns A logger plus the lifecycle state required by Fastify and health probes.
 * @throws When required file logging cannot pass startup preflight or initialize its transport.
 */
export function createServerLoggerRuntime(options: CreateServerLoggerRuntimeOptions): ServerLoggerRuntime {
  const stdout = createStdoutDestination(options.pretty);
  const stdoutLogger = pino(createServerLogOptions(options.level), stdout);
  if (!options.fileLogging.enabled) {
    return createRuntime(stdoutLogger, { state: 'disabled', required: options.fileLogging.required });
  }

  let transport: FileLogTransport;
  let lease: FileLogLease | undefined;
  try {
    preflightFileLogging(options.logsRoot);
    lease = acquireFileLogLease(options.logsRoot);
    clearActiveLogMarker(options.logsRoot);
    transport = createFileLogTransport(options.logsRoot, options.fileLogging);
  } catch (error) {
    lease?.close();
    if (options.fileLogging.required) {
      throw new ServerFileLoggingInitializationError(error);
    }
    stdoutLogger.warn(
      { errorCode: 'SERVER_FILE_LOG_INIT_FAILED', event: 'server.file-log.degraded' },
      'Local file logging is unavailable; continuing with stdout'
    );
    return createRuntime(stdoutLogger, {
      state: 'degraded',
      required: false,
      errorCode: 'SERVER_FILE_LOG_INIT_FAILED',
    });
  }

  const guardedFile = new GuardedDestination(transport);
  const destination = pino.multistream([
    { level: options.level, stream: stdout },
    { level: options.fileLogging.level, stream: guardedFile },
  ]);
  const loggerLevel = selectMostVerboseLevel(options.level, options.fileLogging.level);
  const logger = pino(createServerLogOptions(loggerLevel), destination);
  const health: FileLoggingHealth = {
    state: 'healthy',
    required: options.fileLogging.required,
  };
  const retention = new LogRetentionManager(options.logsRoot, options.fileLogging, () => {
    stdoutLogger.warn(
      { errorCode: 'SERVER_FILE_LOG_RETENTION_FAILED', event: 'server.file-log.retention-failed' },
      'Local file log retention failed and will be retried'
    );
  });
  const degrade = (errorCode: string) => {
    if (health.state === 'degraded') {
      return;
    }
    guardedFile.disable();
    health.state = 'degraded';
    health.errorCode = errorCode;
    stdoutLogger.error(
      { errorCode: health.errorCode, event: 'server.file-log.degraded' },
      'Local file logging failed; stdout remains available'
    );
  };
  const startup = waitForTransportStartup(transport, () => degrade('SERVER_FILE_LOG_START_TIMEOUT'));
  transport.on('error', () => degrade('SERVER_FILE_LOG_TRANSPORT_FAILED'));
  return createRuntime(
    logger,
    health,
    transport,
    retention,
    lease,
    join(options.logsRoot, '.server-log-active'),
    async () => {
      const started = await startup;
      if (started) {
        await retention.start();
      }
      if (!started && options.fileLogging.required) {
        throw new ServerFileLoggingInitializationError(
          new Error(health.errorCode ?? 'SERVER_FILE_LOG_TRANSPORT_FAILED')
        );
      }
    },
    () => degrade('SERVER_FILE_LOG_CLOSE_FAILED')
  );
}

/**
 * Encapsulates a startup failure so infrastructure details do not escape configuration composition.
 */
export class ServerFileLoggingInitializationError extends Error {
  /**
   * @param cause Original filesystem or transport creation failure retained for local diagnostics.
   */
  public constructor(cause: unknown) {
    super('Required Server file logging could not be initialized.', { cause });
    this.name = 'ServerFileLoggingInitializationError';
  }
}

/**
 * Creates the concrete runtime while keeping close idempotent for Fastify and test callers.
 */
function createRuntime(
  logger: FastifyBaseLogger,
  health: FileLoggingHealth,
  transport?: FileLogTransport,
  retention?: LogRetentionManager,
  lease?: FileLogLease,
  activeMarkerPath?: string,
  ready: () => Promise<void> = async () => {},
  onCloseError?: () => void
): ServerLoggerRuntime {
  let closing: Promise<void> | undefined;
  return {
    logger,
    getHealth() {
      return { ...health };
    },
    ready,
    close() {
      closing ??= closeFileLogging({
        transport,
        retention,
        lease,
        activeMarkerPath,
        onError: onCloseError,
      });
      return closing;
    },
  };
}

/**
 * Stops forwarding after a worker error while allowing the stdout multistream branch to continue.
 */
class GuardedDestination implements DestinationStream {
  readonly #transport: FileLogTransport;
  #enabled = true;

  /**
   * @param transport Worker-backed file destination.
   */
  public constructor(transport: FileLogTransport) {
    this.#transport = transport;
  }

  /**
   * Forwards one serialized line only while the file destination remains healthy.
   *
   * @param message Serialized Pino JSON line.
   */
  public write(message: string): void {
    if (this.#enabled) {
      this.#transport.write(sanitizeFileLogLine(message));
    }
  }

  /**
   * Permanently disables forwarding after the first transport failure.
   */
  public disable(): void {
    this.#enabled = false;
  }
}
