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
      new Option('--increment <level>', 'Repository version increment for --bump')
        .choices(['patch', 'minor', 'major'])
        .conflicts(['resume', 'githubOnly', 'dryRun'])
        .implies({ bump: true })
    )
    .addOption(
      new Option('--executor-increment <level>', 'Executor version increment for --bump')
        .choices(['patch', 'minor', 'major'])
        .conflicts(['resume', 'githubOnly', 'dryRun'])
        .implies({ bump: true })
    )
    .addOption(
      new Option('--github-only', 'Complete GitHub Release after npm publication').conflicts('dryRun')
    )
    .option('--dry-run', 'Preview npm publication without uploading or changing tags')
    .option('--skip-build', 'Reuse the existing release directory')
    .option('-y, --yes', 'Approve publication without prompting; version increments stay explicit')
    .addOption(new Option('--ci', 'Run without prompts; implies --yes').implies({ yes: true }));
}

/**
 * Keeps terminal prompts disabled for explicit automation and CI, even when a terminal is allocated.
 */
export function isInteractivePublication(
  options,
  { terminal = Boolean(process.stdin.isTTY), environment = process.env } = {}
) {
  const ci = environment.CI && !['0', 'false'].includes(environment.CI.toLowerCase());
  return terminal && !ci && environment.GITHUB_ACTIONS !== 'true' && !options.ci && !options.yes;
}

/**
 * Rejects incomplete automation before authentication, building, version writes, or Git mutations.
 */
export function assertPublicationArguments(
  options,
  { interactive = isInteractivePublication(options) } = {}
) {
  if (interactive || options.dryRun) return;
  if (!options.bump && !options.resume && !options.githubOnly) {
    throw new Error('Choose --resume, --bump, or --github-only for noninteractive publication.');
  }
  if (!options.yes) throw new Error('Noninteractive publication requires --yes or --ci.');
  if (options.bump && (!options.increment || !options.executorIncrement)) {
    throw new Error(
      'Noninteractive --bump requires both --increment and --executor-increment (patch, minor, or major).'
    );
  }
}
