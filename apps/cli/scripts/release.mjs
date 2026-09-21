/**
 * @author Codex
 * @description Builds and atomically assembles the configured npm bootstrap and internal runtime archive.
 */
import { access, mkdtemp, readFile, realpath, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isInside } from './workspace-release.mjs';
import { assembleRelease } from './assemble-release.mjs';
import { assertSchedulerReleaseIdle } from '../src/release-use.ts';
import { getGatewayStatus } from '../src/gateway/index.ts';
import { execute, pnpmCommand } from '../src/process.ts';
import { readReleaseConfig, resourcePath } from '../src/distribution/config.ts';
import { findConfiguration } from '../src/distribution/location.ts';

const configPath = findConfiguration(dirname(fileURLToPath(import.meta.url)), 'release.config.json');
if (!configPath) throw new Error('release.config.json was not found above the release script.');
const repoRoot = dirname(configPath);
const config = readReleaseConfig(configPath);
const release = join(repoRoot, config.outputDirectory);
const pnpm = await pnpmCommand(repoRoot);
const projects = JSON.parse(
  await execute(pnpm.command, [...pnpm.args, '-r', 'list', '--depth', '-1', '--json'], repoRoot)
);
const sdkRoot = join(repoRoot, resourcePath(repoRoot, projects, config.paths.cli));
if (
  projects.some(
    (project) =>
      resolve(project.path) !== repoRoot &&
      (isInside(release, project.path) || isInside(project.path, release))
  )
) {
  throw new Error('Release output overlaps a workspace package.');
}
const sourceManifest = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
if (sourceManifest.packageManager !== `pnpm@${config.pnpmVersion}`) {
  throw new Error('release.config.json pnpmVersion must match the workspace packageManager.');
}

/**
 * Refuses to replace a linked directory or assets currently used by a service or installer.
 */
async function assertReplaceable() {
  if (release !== resolve(repoRoot, config.outputDirectory) || !isInside(repoRoot, release)) {
    throw new Error('Unsafe release target');
  }
  const existing = await realpath(release).catch((error) => {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    return release;
  });
  if (existing !== release) {
    throw new Error('Release must not be a symlink');
  }
  try {
    await access(release);
    const manifest = JSON.parse(await readFile(join(release, 'package.json'), 'utf8'));
    if (manifest.name !== config.manifest.name) {
      throw new Error('Existing output is not a release of this package.');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // A missing output is safe, but an existing non-release directory is never replaced.
    await access(release).then(
      () => {
        throw new Error('Existing output has no release manifest.');
      },
      () => {}
    );
  }
  try {
    await access(join(release, '.deps-install.lock'));
    throw new Error('Release dependency installation is in progress.');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  await assertSchedulerReleaseIdle(release, sdkRoot);
  const status = await getGatewayStatus();
  if (status && isInside(release, status.entryPath)) {
    throw new Error('Release is in use by a Gateway. Stop it before rebuilding.');
  }
}

await assertReplaceable();
await execute(pnpm.command, [...pnpm.args, ...config.buildArgs], repoRoot, 'inherit', 900_000);
const staging = await mkdtemp(join(repoRoot, '.release-'));
if (!isInside(repoRoot, staging) || !staging.startsWith(join(repoRoot, '.release-'))) {
  throw new Error('Unsafe staging target');
}
try {
  await assembleRelease(repoRoot, staging, projects, config);
  await assertReplaceable();
  await rm(release, { recursive: true, force: true });
  await rename(staging, release);
  console.log(`⚡Release ready: ${release}`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
