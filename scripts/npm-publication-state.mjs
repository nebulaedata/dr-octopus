/**
 * @author Codex
 * @description Determines whether an exact npm version exists, failing closed on ambiguous registry responses.
 */
import { execute } from '../apps/cli/src/process.ts';

/**
 * Only npm's explicit E404 means a version is available; authentication and network failures propagate.
 * @returns {Promise<'published' | 'available'>}
 */
export async function getNpmPublicationState(root, npm, registry, name, version, run = execute) {
  let published;
  try {
    published = await run(
      npm.command,
      [...npm.args, 'view', `${name}@${version}`, 'version', `--registry=${registry}`],
      root
    );
  } catch (error) {
    if (/\bE404\b/.test(error.message)) return 'available';
    throw error;
  }
  if (published !== version) {
    throw new Error(`Unexpected npm version lookup result for ${name}@${version}: ${published}`);
  }
  return 'published';
}
