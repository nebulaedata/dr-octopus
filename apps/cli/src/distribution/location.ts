/**
 * @author Codex
 * @description Finds the adjacent publication index or development configuration without relying on repository depth.
 */
import { existsSync, globSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { userInfo } from 'node:os';
import { parse } from 'yaml';
import { createReleaseLayout, readReleaseConfig, readReleaseLayout } from './config.js';
import type { ReleaseLayout, WorkspaceProject } from './config.js';

export interface Distribution {
  root: string;
  layout: ReleaseLayout;
  packaged: boolean;
}

let cached: Distribution | undefined;

/**
 * Finds a named configuration by walking ancestors of the executing module, never the caller's cwd.
 */
export function findConfiguration(start: string, name: string): string | undefined {
  let directory = resolve(start);
  while (true) {
    if (existsSync(join(directory, name))) {
      return join(directory, name);
    }
    const parent = dirname(directory);
    if (parent === directory) {
      return undefined;
    }
    directory = parent;
  }
}

/**
 * Locates already-installed development packages using the workspace's own package globs.
 */
function developmentProjects(root: string): WorkspaceProject[] {
  const workspace = parse(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')) as { packages: string[] };
  const patterns = workspace.packages
    .filter((pattern) => !pattern.startsWith('!'))
    .map((pattern) => `${pattern}/package.json`);
  const excluded = workspace.packages
    .filter((pattern) => pattern.startsWith('!'))
    .map((pattern) => `${pattern.slice(1)}/**`);
  return [...globSync(patterns, { cwd: root, exclude: excluded })].map((path) => {
    const manifest = JSON.parse(readFileSync(join(root, path), 'utf8')) as { name: string };
    return { name: manifest.name, path: dirname(join(root, path)) };
  });
}

/**
 * Resolves configuration lazily so a standalone CLI can still print help without any payload or dependencies.
 */
export function distribution(): Distribution {
  if (cached) {
    return cached;
  }
  const start = dirname(fileURLToPath(import.meta.url));
  const index = findConfiguration(start, 'release-layout.json');
  if (index) {
    const layout = readReleaseLayout(index);
    return (cached = { root: dirname(index), layout, packaged: Boolean(layout.archive) });
  }
  const configPath = findConfiguration(start, 'release.config.json');
  if (!configPath) {
    throw new Error('Release configuration is missing. Reinstall the Octopus npm package.');
  }
  const root = dirname(configPath);
  return (cached = {
    root,
    layout: createReleaseLayout(root, developmentProjects(root), readReleaseConfig(configPath)),
    packaged: false,
  });
}

/**
 * Reports packaged mode without forcing discovery of runtime resources for help and version commands.
 */
export function isPackaged(): boolean {
  const index = findConfiguration(dirname(fileURLToPath(import.meta.url)), 'release-layout.json');
  return index ? Boolean(readReleaseLayout(index).archive) : false;
}

/**
 * Reads the configured command for help and guidance without requiring installed workspace resources.
 */
export function cliCommand(): string {
  const start = dirname(fileURLToPath(import.meta.url));
  const index = findConfiguration(start, 'release-layout.json');
  if (index) {
    return readReleaseLayout(index).command;
  }
  const config = findConfiguration(start, 'release.config.json');
  return config ? readReleaseConfig(config).command : 'dr-octopus';
}

/**
 * Isolates writable dependencies by payload identity, platform and Node ABI, outside npm's installation tree.
 */
export function runtimeDirectory(context: Distribution = distribution()): string {
  if (!context.packaged) {
    return context.root;
  }
  // Keep native build paths within Windows tool limits; extraction still verifies the full SHA-256.
  const key = `${context.layout.sha256!.slice(0, 24)}-${process.platform}-${process.arch}-${process.versions.modules}`;
  return join(userInfo().homedir, context.layout.runtimeDirectory, key);
}
