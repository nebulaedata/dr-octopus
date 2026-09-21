/**
 * @author Codex
 * @description Creates the local Claude skills directory link from the Git-tracked agent skills source.
 */

import { lstat, mkdir, realpath, symlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const sourcePath = path.join(projectRoot, '.agents', 'skills');
const linkPath = path.join(projectRoot, '.claude', 'skills');

/**
 * Reads path metadata without treating a missing path as an exceptional condition.
 *
 * @param {string} targetPath Path whose metadata should be read.
 * @returns {Promise<import('node:fs').Stats | null>} Path metadata, or null when the path does not exist.
 */
async function getPathStats(targetPath) {
  try {
    return await lstat(targetPath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

/**
 * Normalizes a resolved path for reliable platform-specific comparison.
 *
 * @param {string} targetPath Resolved filesystem path.
 * @returns {string} Comparable normalized path.
 */
function normalizeForComparison(targetPath) {
  const normalizedPath = path.normalize(targetPath);
  return process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath;
}

/**
 * Verifies an existing link points at the canonical skills directory.
 *
 * @param {string} expectedSourcePath Canonical source directory.
 * @param {string} existingLinkPath Existing filesystem link.
 * @returns {Promise<boolean>} True when the existing link is already correct.
 */
async function isExpectedLink(expectedSourcePath, existingLinkPath) {
  try {
    const [resolvedSource, resolvedLink] = await Promise.all([
      realpath(expectedSourcePath),
      realpath(existingLinkPath),
    ]);

    return normalizeForComparison(resolvedSource) === normalizeForComparison(resolvedLink);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

/**
 * Creates the platform-appropriate local skills link without overwriting existing data.
 *
 * @returns {Promise<void>}
 */
async function main() {
  const sourceStats = await getPathStats(sourcePath);
  if (!sourceStats?.isDirectory()) {
    throw new Error(`Skill source directory does not exist: ${sourcePath}`);
  }

  await mkdir(path.dirname(linkPath), { recursive: true });

  const existingStats = await getPathStats(linkPath);
  if (existingStats) {
    if (existingStats.isSymbolicLink() && (await isExpectedLink(sourcePath, linkPath))) {
      console.log(`Skills link already exists: ${linkPath}`);
      return;
    }

    throw new Error(
      `Refusing to replace existing path: ${linkPath}\n` +
        'Move or remove it manually after preserving any required content, then run this command again.'
    );
  }

  const isWindows = process.platform === 'win32';
  const linkTarget = isWindows
    ? await realpath(sourcePath)
    : path.relative(path.dirname(linkPath), sourcePath);

  await symlink(linkTarget, linkPath, isWindows ? 'junction' : 'dir');
  console.log(`Created skills link: ${linkPath} -> ${linkTarget}`);
}

/**
 * Reports an unrecoverable setup failure without masking it as a successful command.
 *
 * @param {unknown} error Failure raised while validating or creating the link.
 * @returns {void}
 */
function handleFailure(error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

main().catch(handleFailure);
