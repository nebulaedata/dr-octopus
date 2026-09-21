/**
 * @author Codex
 * @description Provides side-effect-free layered environment loading, source inspection, and revision-checked edits.
 */
import { isAbsolute } from 'node:path';
import { parseEnv } from 'node:util';
import { patchEnvironmentFile, readEnvironmentFile, readEnvironmentText } from './file-store.js';
import { EnvironmentError } from './types.js';
import type {
  EnvironmentOptions,
  EnvironmentSnapshot,
  EnvironmentSource,
  EnvironmentUpdateOptions,
} from './types.js';

export { EnvironmentError } from './types.js';
export { validateEnvironment } from './file-store.js';
export type {
  EnvironmentOptions,
  EnvironmentSnapshot,
  EnvironmentSource,
  EnvironmentValues,
  EnvironmentUpdateOptions,
} from './types.js';

/**
 * Loads a snapshot with overrides > process > explicit dotenv > JSON > defaults.
 * Missing values fall through; empty strings remain explicit values. Never mutates process.env.
 */
export function loadEnvironment(options: EnvironmentOptions): EnvironmentSnapshot {
  if (!isAbsolute(options.path) || (options.dotenvPath && !isAbsolute(options.dotenvPath))) {
    throw new EnvironmentError('ENV_INVALID', 'Environment file paths must be absolute.');
  }
  const { persisted, revision } = readEnvironmentFile(options.path);
  if (!options.diagnosticReads) {
    options.validate?.(persisted);
  }
  return resolveEnvironment(options, { persisted, revision });
}

/**
 * Projects an exact persisted snapshot without rereading the configuration file.
 */
function resolveEnvironment(
  options: EnvironmentOptions,
  { persisted, revision }: Pick<EnvironmentSnapshot, 'persisted' | 'revision'>
): EnvironmentSnapshot {
  const dotenv = options.dotenvPath ? parseEnv(readEnvironmentText(options.dotenvPath) ?? '') : {};
  const values: Record<string, string> = {};
  const sources: Record<string, EnvironmentSource> = {};
  const names = new Map<string, string>();
  const layers = [
    ['default', options.defaults ?? {}],
    ['file', persisted],
    ['dotenv', dotenv],
    ['process', options.environment ?? process.env],
    ['override', options.overrides ?? {}],
  ] as const;
  for (const [source, layer] of layers) {
    for (const [key, value] of Object.entries(layer)) {
      if (value !== undefined) {
        const identity = process.platform === 'win32' ? key.toUpperCase() : key;
        const name = names.get(identity) ?? key;
        names.set(identity, name);
        Object.defineProperty(values, name, { value, enumerable: true, configurable: true });
        Object.defineProperty(sources, name, { value: source, enumerable: true, configurable: true });
      }
    }
  }
  return Object.freeze({
    path: options.path,
    revision,
    persisted,
    values: Object.freeze(values),
    sources: Object.freeze(sources),
  });
}

/**
 * Reads an own property using the operating system's environment name semantics.
 */
function lookup<T>(values: Readonly<Record<string, T>>, key: string): T | undefined {
  const name =
    process.platform === 'win32'
      ? Object.keys(values).find((candidate) => candidate.toUpperCase() === key.toUpperCase())
      : key;
  return name !== undefined && Object.hasOwn(values, name) ? values[name] : undefined;
}

/**
 * Creates an isolated store with captured high-priority inputs; updates affect only its JSON file.
 */
export function createEnvironmentStore(options: EnvironmentOptions) {
  const captured = {
    ...options,
    environment: { ...(options.environment ?? process.env) },
    defaults: { ...options.defaults },
    overrides: { ...options.overrides },
  };
  return {
    /**
     * Reads the latest persisted document and resolves all layers.
     */
    load: () => loadEnvironment(captured),
    /**
     * Retrieves the resolved value of one variable.
     */
    get: (key: string) => lookup(loadEnvironment(captured).values, key),
    /**
     * Explains the winning layer for one variable.
     */
    source: (key: string) => lookup(loadEnvironment(captured).sources, key),
    /**
     * Atomically patches persisted values, preserving unrelated keys and detecting stale edits.
     */
    async update(
      revision: string,
      changes: Readonly<Record<string, string | null>>,
      options?: EnvironmentUpdateOptions
    ) {
      if (!isAbsolute(captured.path)) {
        throw new EnvironmentError('ENV_INVALID', 'Environment file paths must be absolute.');
      }
      const committed = await patchEnvironmentFile(
        captured.path,
        revision,
        changes,
        captured.validate,
        options
      );
      return resolveEnvironment(captured, committed);
    },
  };
}
