/**
 * @author Codex
 * @description Defines the internal lifecycle and health contracts for optional Server file logging.
 */

import type { FastifyBaseLogger } from 'fastify';

export type FileLoggingState = 'disabled' | 'healthy' | 'degraded';

export interface FileLoggingHealth {
  state: FileLoggingState;
  required: boolean;
  errorCode?: string;
}

export interface ServerLoggerRuntime {
  logger: FastifyBaseLogger;

  /**
   * Returns a disclosure-safe snapshot consumed by readiness diagnostics.
   */
  getHealth(): FileLoggingHealth;

  /**
   * Waits for the optional transport startup gate and enforces required-mode failure.
   */
  ready(): Promise<void>;

  /**
   * Stops retention work and drains the optional transport exactly once.
   */
  close(): Promise<void>;
}
