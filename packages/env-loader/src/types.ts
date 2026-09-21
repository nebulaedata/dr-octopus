/**
 * @author Codex
 * @description Defines host-independent environment storage, precedence, and diagnostics contracts.
 */
export type EnvironmentValues = Readonly<Record<string, string>>;
export type EnvironmentSource = 'override' | 'process' | 'dotenv' | 'file' | 'default';

export interface EnvironmentSnapshot {
  readonly path: string;
  readonly revision: string;
  readonly persisted: EnvironmentValues;
  readonly values: EnvironmentValues;
  readonly sources: Readonly<Record<string, EnvironmentSource>>;
}

export interface EnvironmentOptions {
  path: string;
  defaults?: EnvironmentValues;
  environment?: Readonly<Record<string, string | undefined>>;
  /** Explicit development-only file; never discovered from cwd. */
  dotenvPath?: string;
  overrides?: EnvironmentValues;
  /**
   * Validates persisted values independently of higher-priority overrides.
   */
  validate?(this: void, values: EnvironmentValues): void;
  /** Allow diagnostic reads while retaining structural validation and strict writes. */
  diagnosticReads?: boolean;
}

export interface EnvironmentUpdateOptions {
  /**
   * Checks a revision-matched candidate under the writer lock before committing.
   */
  check?(current: EnvironmentValues, next: EnvironmentValues): void;
}

/**
 * Carries safe diagnostics without including file contents or credential values.
 */
export class EnvironmentError extends Error {
  /**
   * Creates a stable error for invalid data, IO failures, or concurrent writes.
   */
  constructor(
    public readonly code: 'ENV_INVALID' | 'ENV_IO' | 'ENV_CONFLICT' | 'ENV_BUSY',
    message: string
  ) {
    super(message);
    this.name = 'EnvironmentError';
  }
}
