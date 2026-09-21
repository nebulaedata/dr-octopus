/**
 * @author Codex
 * @description Locates release assets from the executing CLI, independent of the caller's working directory.
 */
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { userInfo } from 'node:os';
import { distribution, runtimeDirectory } from './distribution/location.js';
import { insidePath, readReleaseLayout } from './distribution/config.js';

/**
 * Returns the configured development root or the writable, versioned packaged runtime.
 */
export function releaseRoot(): string {
  return runtimeDirectory();
}

/**
 * Locates package-owned files in the preserved workspace layout, without installed dependencies.
 */
export function releasePaths(root = releaseRoot()) {
  const context = distribution();
  const layout =
    root === releaseRoot() ? context.layout : readReleaseLayout(join(root, 'release-layout.json'));
  return Object.fromEntries(
    Object.entries(layout.paths).map(([key, path]) => [key, insidePath(root, path)])
  ) as Record<keyof typeof layout.paths, string>;
}

/**
 * Validates absolute runtime data directories without importing Pi configuration.
 */
export function dataDirectory(value: string | undefined, kind: 'server' | 'agent'): string {
  const path = value?.trim() || join(userInfo().homedir, '.dr-octopus', kind);
  if (!isAbsolute(path) || dirname(resolve(path)) === resolve(path)) {
    throw new Error(`${kind} data directory must be absolute and cannot be a filesystem root.`);
  }
  return resolve(path);
}
