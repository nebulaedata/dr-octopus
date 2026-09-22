/**
 * @author Codex
 * @description Validates the standalone release configuration and resolves declared resources from discovered packages.
 */
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export interface PackageResource {
  package: string;
  path: string;
}

export interface ReleaseConfig {
  schemaVersion: 1;
  outputDirectory: string;
  readme: string;
  readmeTranslations?: Record<string, string>;
  buildArgs: string[];
  manifest: {
    name: string;
    version: string;
    description: string;
    license: string;
    repository?: string | { type: string; url: string; directory?: string };
    homepage?: string;
    bugs?: string | { url?: string; email?: string };
    keywords?: string[];
    engines: { node: string };
  };
  pnpmVersion: string;
  runtimeDirectory: string;
  command: string;
  bootstrap: PackageResource & { destination: string };
  archive: string;
  installFilter: string;
  artifacts: Record<string, string[]>;
  requiredFiles?: PackageResource[];
  paths: Record<'cli' | 'server' | 'serverEntry' | 'gatewayEntry' | 'webClient', PackageResource>;
}

export interface ReleaseLayout {
  schemaVersion: 1;
  name: string;
  version: string;
  pnpmVersion: string;
  command: string;
  runtimeDirectory: string;
  installFilter: string;
  paths: Record<keyof ReleaseConfig['paths'], string>;
  archive?: string;
  sha256?: string;
}

export interface WorkspaceProject {
  name: string;
  path: string;
}

/**
 * Rejects absolute paths, traversal and Windows-specific path syntax before any copy or extraction.
 */
export function portablePath(value: unknown, allowDot = false): asserts value is string {
  if (
    typeof value !== 'string' ||
    !value ||
    isAbsolute(value) ||
    /[\\:*?]/.test(value) ||
    value.includes('\0') ||
    value.split('/').some((part) => !part || part === '..' || (part === '.' && !(allowDot && value === '.')))
  ) {
    throw new Error(`Invalid release-relative path: ${String(value)}`);
  }
}

/**
 * Resolves a strict descendant, preventing configuration from escaping the designated root.
 */
export function insidePath(root: string, path: string): string {
  portablePath(path, true);
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) {
    throw new Error(`Release path escapes root: ${path}`);
  }
  return target;
}

/**
 * Accepts npm metadata strings or objects with non-empty, explicitly supported string fields.
 */
function validPublicationLink(value: unknown, allowed: string[], required: string[]): boolean {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  return (
    Object.keys(fields).length > 0 &&
    required.every((key) => key in fields) &&
    Object.entries(fields).every(
      ([key, entry]) => allowed.includes(key) && typeof entry === 'string' && entry.trim().length > 0
    )
  );
}

/**
 * Reads the sole editable release contract; unknown publication fields fail instead of leaking dev metadata.
 */
export function readReleaseConfig(path: string): ReleaseConfig {
  const config = JSON.parse(readFileSync(path, 'utf8')) as ReleaseConfig;
  if (
    config?.schemaVersion !== 1 ||
    !/^\d+\.\d+\.\d+$/.test(config.pnpmVersion ?? '') ||
    typeof config.manifest?.name !== 'string' ||
    !/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(config.manifest.name) ||
    !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(config.manifest.version ?? '') ||
    typeof config.manifest.engines?.node !== 'string' ||
    !config.manifest.engines.node.trim() ||
    typeof config.manifest.license !== 'string' ||
    !config.manifest.license.trim() ||
    typeof config.manifest.description !== 'string' ||
    !config.manifest.description.trim() ||
    !/^[a-zA-Z0-9][\w.-]*$/.test(config.command ?? '') ||
    typeof config.installFilter !== 'string' ||
    !config.installFilter.trim() ||
    !Array.isArray(config.buildArgs) ||
    config.buildArgs.length === 0 ||
    !config.buildArgs.every((arg) => typeof arg === 'string') ||
    !config.artifacts ||
    typeof config.artifacts !== 'object' ||
    Array.isArray(config.artifacts) ||
    (config.manifest.repository !== undefined &&
      !validPublicationLink(config.manifest.repository, ['type', 'url', 'directory'], ['type', 'url'])) ||
    (config.manifest.homepage !== undefined &&
      (typeof config.manifest.homepage !== 'string' || !config.manifest.homepage.trim())) ||
    (config.manifest.bugs !== undefined &&
      !validPublicationLink(config.manifest.bugs, ['url', 'email'], [])) ||
    (config.manifest.keywords !== undefined &&
      (!Array.isArray(config.manifest.keywords) ||
        !config.manifest.keywords.every((keyword) => typeof keyword === 'string')))
  ) {
    throw new Error('Invalid release.config.json publication or build settings.');
  }
  for (const key of Object.keys(config.manifest)) {
    if (
      ![
        'name',
        'version',
        'description',
        'license',
        'repository',
        'homepage',
        'bugs',
        'keywords',
        'engines',
      ].includes(key)
    ) {
      throw new Error(`Unsupported publication metadata: ${key}`);
    }
  }
  for (const path of [
    config.outputDirectory,
    config.readme,
    config.archive,
    config.bootstrap?.destination,
    config.runtimeDirectory,
  ]) {
    portablePath(path);
  }
  if (config.outputDirectory.includes('/') || !config.archive.endsWith('.tar.gz')) {
    throw new Error('Release output must be one root directory and archive must use .tar.gz.');
  }
  if (config.readmeTranslations !== undefined) {
    if (
      !config.readmeTranslations ||
      typeof config.readmeTranslations !== 'object' ||
      Array.isArray(config.readmeTranslations)
    ) {
      throw new Error('Release README translations must map published filenames to source paths.');
    }
    for (const [destination, source] of Object.entries(config.readmeTranslations)) {
      if (!/^README\.[a-zA-Z0-9-]+\.md$/.test(destination)) {
        throw new Error(`Invalid translated README filename: ${destination}`);
      }
      portablePath(source);
    }
  }
  const publishedPaths = [
    'package.json',
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'README.md',
    ...Object.keys(config.readmeTranslations ?? {}),
    'release-layout.json',
    config.bootstrap.destination,
    config.archive,
  ];
  for (const [index, path] of publishedPaths.entries()) {
    if (
      publishedPaths.some(
        (other, otherIndex) =>
          index !== otherIndex &&
          (path.toLowerCase() === other.toLowerCase() ||
            path.toLowerCase().startsWith(other.toLowerCase() + '/'))
      )
    ) {
      throw new Error('Publication file paths must not overlap.');
    }
  }
  for (const key of ['cli', 'server', 'serverEntry', 'gatewayEntry', 'webClient'] as const) {
    if (!config.paths?.[key]?.package) {
      throw new Error(`Missing release resource: ${key}`);
    }
    portablePath(config.paths[key].path, true);
  }
  if (!config.bootstrap.package) {
    throw new Error('Missing bootstrap package.');
  }
  portablePath(config.bootstrap.path);
  for (const paths of Object.values(config.artifacts)) {
    if (!Array.isArray(paths)) {
      throw new Error('Release artifacts must be arrays of package-relative paths.');
    }
    paths.forEach((path) => portablePath(path));
  }
  if (config.requiredFiles !== undefined) {
    if (!Array.isArray(config.requiredFiles)) {
      throw new Error('Release requiredFiles must be an array of package resources.');
    }
    for (const resource of config.requiredFiles) {
      if (typeof resource?.package !== 'string' || !resource.package.trim()) {
        throw new Error('Required release file must declare a package.');
      }
      portablePath(resource.path);
    }
  }
  return config;
}

/**
 * Resolves a package by identity rather than a hard-coded source directory.
 */
export function resourcePath(root: string, projects: WorkspaceProject[], resource: PackageResource): string {
  const matches = projects.filter((project) => project.name === resource.package);
  if (matches.length !== 1) {
    throw new Error(`Expected one workspace package named ${resource.package}.`);
  }
  const path = relative(root, resolve(matches[0]!.path, resource.path)).split(sep).join('/');
  portablePath(path);
  return path;
}

/**
 * Builds an automatically derived runtime index shared by packaging and CLI path resolution.
 */
export function createReleaseLayout(
  root: string,
  projects: WorkspaceProject[],
  config: ReleaseConfig
): ReleaseLayout {
  const paths = Object.fromEntries(
    Object.entries(config.paths).map(([key, resource]) => [key, resourcePath(root, projects, resource)])
  ) as ReleaseLayout['paths'];
  return {
    schemaVersion: 1,
    name: config.manifest.name,
    version: config.manifest.version,
    pnpmVersion: config.pnpmVersion,
    command: config.command,
    runtimeDirectory: config.runtimeDirectory,
    installFilter: config.installFilter,
    paths,
  };
}

/**
 * Validates a generated index before it influences filesystem locations or installer arguments.
 */
export function readReleaseLayout(path: string): ReleaseLayout {
  const layout = JSON.parse(readFileSync(path, 'utf8')) as ReleaseLayout;
  if (
    layout?.schemaVersion !== 1 ||
    !layout.name ||
    !layout.version ||
    !/^\d+\.\d+\.\d+$/.test(layout.pnpmVersion ?? '') ||
    !layout.installFilter
  ) {
    throw new Error('Invalid release-layout.json.');
  }
  for (const key of ['cli', 'server', 'serverEntry', 'gatewayEntry', 'webClient'] as const) {
    portablePath(layout.paths?.[key]);
  }
  portablePath(layout.runtimeDirectory);
  if (!/^[\w.-]+$/.test(layout.command ?? '')) {
    throw new Error('Invalid release command name.');
  }
  if (layout.archive !== undefined || layout.sha256 !== undefined) {
    portablePath(layout.archive);
    if (!/^[a-f0-9]{64}$/.test(layout.sha256 ?? '')) {
      throw new Error('Invalid runtime archive checksum.');
    }
  }
  return layout;
}
