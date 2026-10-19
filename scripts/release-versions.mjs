/**
 * @author Codex
 * @description Plans independent repository and Executor versions and updates only the Executor manifest in the release-it bump lifecycle.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inc, valid, gt } from 'semver';

/**
 * Validates version values without accepting normalized, partial, or unchanged versions.
 */
function version(value, label) {
  if (typeof value !== 'string' || valid(value) !== value)
    throw new Error(`Invalid ${label} version: ${String(value)}`);
  return value;
}

/**
 * Computes an explicit product increment; retries never enter this function.
 */
export function incrementExecutorVersion(current, increment) {
  version(current, 'Executor');
  if (!['patch', 'minor', 'major'].includes(increment))
    throw new Error('Executor increment must be patch, minor, or major.');
  return inc(current, increment);
}

/**
 * Reads the two authoritative manifests and returns a side-effect-free preview of the next release.
 * The repository target may be an exact SemVer supplied by release-it, including a prerelease.
 */
export async function planReleaseVersions(root, { increment, executorIncrement }) {
  const repository = JSON.parse(await readFile(join(root, 'release.config.json'), 'utf8'));
  const executor = JSON.parse(await readFile(join(root, 'apps/executor/package.json'), 'utf8'));
  const current = version(repository.manifest.version, 'repository');
  const next = ['patch', 'minor', 'major'].includes(increment) ? inc(current, increment) : increment;
  version(next, 'repository target');
  if (!gt(next, current))
    throw new Error(`Select a new version greater than ${current}; retries use --resume.`);
  return {
    repository: { current, next },
    executor: {
      current: executor.version,
      next: incrementExecutorVersion(executor.version, executorIncrement),
    },
  };
}

/**
 * Runs only in release-it's version bump lifecycle, before its shared version commit and tag.
 * Updates the existing JSON version token in place, preserving all unrelated bytes and line endings.
 */
export async function bumpExecutorVersion(root, increment, { expectedVersion } = {}) {
  const path = join(root, 'apps/executor/package.json');
  const before = await readFile(path, 'utf8');
  const manifest = JSON.parse(before);
  if (expectedVersion !== undefined && manifest.version !== expectedVersion)
    throw new Error('Executor version changed after release planning; no version write.');
  const next = incrementExecutorVersion(manifest.version, increment);
  const after = before.replace(
    /("version"\s*:\s*")[^"]*(")/,
    (_match, prefix, suffix) => `${prefix}${next}${suffix}`
  );
  if (JSON.parse(after).version !== next)
    throw new Error('Executor version update did not match its manifest.');
  await writeFile(path, after);
  return { current: manifest.version, next };
}
