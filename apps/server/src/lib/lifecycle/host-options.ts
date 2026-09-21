/**
 * @author Codex
 * @description Defines injectable resource and deadline boundaries for the Server Host.
 */
import type { ServerConfig } from '../config/utils.js';
import type { ServerEnvironmentSnapshot } from '../config/environment.js';
import type { ServerRuntime } from '../../runtime-types.js';
import type { ServerControl } from './control.js';

export interface ServerHostOptions {
  /**
   * Constructs a runtime with the frozen config and generation-specific control port.
   */
  createRuntime?(this: void, options: { config: ServerConfig; control: ServerControl }): ServerRuntime;
  /**
   * Prepares a validated immutable snapshot without changing the running process.
   */
  prepare?(this: void): ServerEnvironmentSnapshot;
  /**
   * Applies only a previously accepted snapshot after teardown.
   */
  apply?(this: void, snapshot: ServerEnvironmentSnapshot): void;
  /**
   * Lets process entrypoints decide how to expose an unrecoverable Host failure.
   */
  onFailure?(): void;
  closeTimeoutMs?: number;
  startTimeoutMs?: number;
}
