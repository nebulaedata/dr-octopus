/**
 * @author Codex
 * @description Declares publication arguments, defaults, and mutually exclusive actions through Commander.
 */
import { Command, InvalidArgumentError, Option } from 'commander';

/**
 * Accepts only absolute HTTP(S) registry URLs before invoking npm.
 */
function registryUrl(value) {
  try {
    const url = new URL(value);
    if (['https:', 'http:'].includes(url.protocol)) return value;
  } catch {
    // Report the same CLI validation error for malformed URLs and unsupported protocols.
  }
  throw new InvalidArgumentError('Registry must be an absolute HTTP(S) URL.');
}

/**
 * Builds a fresh command so Commander owns parsing, help, validation, and usage errors.
 */
export function createPublicationCommand() {
  return new Command('publish-release.mjs')
    .description('Continue an incomplete publication or publish the next version.')
    .addOption(
      new Option('--registry <url>', 'Target npm registry')
        .default('https://registry.npmjs.org/')
        .argParser(registryUrl)
    )
    .option('--otp <code>', 'One-time password for npm publishing')
    .addOption(
      new Option('--resume', 'Continue the current incomplete version from HEAD').conflicts([
        'bump',
        'githubOnly',
        'dryRun',
      ])
    )
    .addOption(
      new Option('--bump', 'Select and publish the next version').conflicts(['githubOnly', 'dryRun'])
    )
    .addOption(
      new Option('--github-only', 'Complete GitHub Release after npm publication').conflicts('dryRun')
    )
    .option('--dry-run', 'Preview npm publication without uploading or changing tags')
    .option('--skip-build', 'Reuse the existing release directory')
    .option('-y, --yes', 'Skip the final publication confirmation');
}
