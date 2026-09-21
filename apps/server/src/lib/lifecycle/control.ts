/**
 * @author Codex
 * @description Serializes configuration commands and exposes the Host-owned restart boundary.
 */
import { ApplicationError } from '../errors/application-error.js';
import type { RestartOperationDto, RestartServerBody } from '@octopus/shared/protocol';
import type { ServerEnvironmentSnapshot } from '../config/environment.js';

export interface ServerControl {
  instanceId: string;
  currentEnvironment?: ServerEnvironmentSnapshot;
  /**
   * Reports whether this instance may accept new work.
   */
  assertOpen(): void;
  /**
   * Reports the Host phase independently of the current HTTP runtime.
   */
  state(): 'running' | 'restarting' | 'stopping' | 'failed';
  queue: ConfigurationQueue;
  /**
   * Accepts one frozen operation and returns an idempotent response-handoff callback.
   */
  restart?(
    body: RestartServerBody,
    key: string
  ): Promise<{ operation: RestartOperationDto; handoff(this: void): void }>;
  /**
   * Reads a bounded Host-owned restart record.
   */
  operation?(id: string): RestartOperationDto;
}

/**
 * Holds only brief configuration work; shutdown and startup never run in this queue.
 */
export class ConfigurationQueue {
  private tail: Promise<unknown> = Promise.resolve();
  /**
   * Preserves command ordering even after a rejected mutation.
   */
  run<T>(action: () => T | Promise<T>): Promise<T> {
    const result = this.tail.then(action);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

/**
 * Creates a safe public error without exposing configuration or infrastructure details.
 */
export function controlError(code: string, message: string, statusCode = 409): ApplicationError {
  return new ApplicationError(code, message, { statusCode, retryable: false });
}
