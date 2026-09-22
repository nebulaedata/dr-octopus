/**
 * @author longlongago2
 * @description Publishes the assembled npm release: offers current-version recovery or a new version, then publishes npm followed by its GitHub Release.
 */
import { readFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cancel } from '@clack/prompts';
import { execute, pnpmCommand } from '../apps/cli/src/process.ts';
import { readReleaseConfig } from '../apps/cli/src/distribution/config.ts';
import { findConfiguration } from '../apps/cli/src/distribution/location.ts';

import { assertGithubReleaseReady, publishGithubRelease } from './github-release.mjs';
import { getGithubPublicationState } from './github-publication-state.mjs';
import { getNpmPublicationState } from './npm-publication-state.mjs';
import { choosePublicationAction, confirmPublication } from './publication-choice.mjs';
import { createPublicationCommand } from './publication-options.mjs';
import { npmCommand } from './npm-command.mjs';
import { resumeReleaseTag } from './resume-release-tag.mjs';

const BUILD_TIMEOUT = 900_000;
const PUBLISH_TIMEOUT = 600_000;
const BUMP_TIMEOUT = 120_000;

const options = createPublicationCommand().parse().opts();

const configPath = findConfiguration(dirname(fileURLToPath(import.meta.url)), 'release.config.json');
if (!configPath) {
  throw new Error('release.config.json was not found above the publish script.');
}
const repoRoot = dirname(configPath);
try {
  loadEnvFile(join(repoRoot, '.env.publish'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  console.warn(
    '⚠ Missing .env.publish in the repository root. Create it and configure GITHUB_TOKEN before publishing. Publication aborted.'
  );
  process.exit(1);
}
let config = readReleaseConfig(configPath);
const release = join(repoRoot, config.outputDirectory);
const npm = await npmCommand(repoRoot);
const pnpm = await pnpmCommand(repoRoot);

/**
 * Confirms the npm account is authenticated with the target registry before anything else runs.
 * @returns {Promise<string>} The logged-in npm username.
 */
async function assertAuthenticated() {
  try {
    const user = await execute(
      npm.command,
      [...npm.args, 'whoami', `--registry=${options.registry}`],
      repoRoot
    );
    console.log(`✓ Authenticated with ${options.registry} as ${user}`);
    return user;
  } catch {
    throw new Error(
      `Not authenticated with ${options.registry}.\nRun: npm login --registry=${options.registry}`
    );
  }
}

/**
 * Reports whether the exact version already exists on the registry; 404s mean it is publishable.
 * @param {string} name Package name from the release manifest.
 * @param {string} version Version planned for publication.
 * @returns {Promise<'published' | 'available'>}
 */
async function getVersionState(name, version) {
  const state = await getNpmPublicationState(repoRoot, npm, options.registry, name, version);
  console.log(`→ ${name}@${version}: ${state} on ${options.registry}`);
  return state;
}

/**
 * Runs release-it to bump release.config.json manifest.version, then reloads the configuration.
 */
async function bumpVersion() {
  console.log('→ Bumping version (release-it --only-version)...');
  const previousVersion = config.manifest.version;
  await execute(pnpm.command, [...pnpm.args, 'run', 'release'], repoRoot, 'inherit', BUMP_TIMEOUT);
  config = readReleaseConfig(configPath);
  if (config.manifest.version === previousVersion) {
    throw new Error(`Version bump did not change ${previousVersion}; aborting publication.`);
  }
  if ((await getVersionState(config.manifest.name, config.manifest.version)) === 'published') {
    throw new Error(`${config.manifest.name}@${config.manifest.version} is already published; aborting.`);
  }
  console.log(`✓ Version bumped to ${config.manifest.version}`);
}

/**
 * Runs npm publish in the release directory, translating OTP/2FA failures into an actionable hint.
 * Streams output live while retaining stderr so npm's own error text stays available for diagnosis.
 * @param {{name: string, version: string}} manifest Built release manifest.
 */
async function publish(manifest) {
  const args = ['publish', `--registry=${options.registry}`];
  if (options.dryRun) args.push('--dry-run');
  if (options.otp) args.push(`--otp=${options.otp}`);
  try {
    await execute(npm.command, [...npm.args, ...args], release, true, PUBLISH_TIMEOUT);
  } catch (error) {
    if (/EOTP|one-time password|Two-factor authentication/i.test(error.message)) {
      throw new Error(
        `${error.message}\n` +
          'Hint: this account requires 2FA for publishing. Re-run with --otp=<code> from your ' +
          'authenticator, or configure a granular access token with 2FA bypass enabled.',
        { cause: error }
      );
    }
    throw error;
  }
  if (options.dryRun) {
    console.log(`✓ Dry run complete — ${manifest.name}@${manifest.version} was not uploaded.`);
  } else {
    console.log(`✓ Published ${manifest.name}@${manifest.version}`);
    console.log(`Install with: npm install -g ${manifest.name}`);
  }
}

/**
 * Inspects both platforms, selects continuation or a new version, then executes only the missing publication steps.
 */
async function main() {
  if (!options.dryRun && !process.env.GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN is required (repository Contents: read and write).');
  }
  await assertAuthenticated();
  const state = await getVersionState(config.manifest.name, config.manifest.version);
  if (options.dryRun) {
    if (state === 'published') console.warn('⚠ Version already published; dry-run skips the version bump.');
  } else {
    const github = await getGithubPublicationState(repoRoot, config.manifest.version);
    console.log(`→ Current publication: npm=${state}, GitHub=${github}`);
    const action = await choosePublicationAction(config.manifest.version, { npm: state, github }, options);
    if (action === 'cancel' || action === 'done') {
      if (action === 'done') console.log('✓ Current version is already fully published.');
      else cancel('Publish aborted.');
      return;
    }
    if (action === 'github-only') {
      const exists = await assertGithubReleaseReady(repoRoot, config.manifest.version, {
        requireHead: false,
      });
      if (!exists) {
        if (!(await confirmPublication(config.manifest, options, { githubOnly: true })))
          return cancel('Publish aborted.');
        await publishGithubRelease(repoRoot, config.manifest.version);
      }
      console.log(`✓ GitHub Release v${config.manifest.version} is published.`);
      return;
    }
    if (action === 'bump') {
      await bumpVersion();
    } else {
      if (options.skipBuild)
        throw new Error('Continuing the current version requires a fresh build; remove --skip-build.');
      await resumeReleaseTag(repoRoot, config.manifest.version, {
        readState: async () => ({
          npm: await getVersionState(config.manifest.name, config.manifest.version),
          github: await getGithubPublicationState(repoRoot, config.manifest.version),
        }),
      });
    }
  }
  const githubExists = options.dryRun
    ? false
    : await assertGithubReleaseReady(repoRoot, config.manifest.version, { pushMissingTag: true });
  if (!options.skipBuild) {
    console.log('→ Building release (pnpm release:build)...');
    await execute(pnpm.command, [...pnpm.args, 'run', 'release:build'], repoRoot, 'inherit', BUILD_TIMEOUT);
  }
  const manifest = JSON.parse(await readFile(join(release, 'package.json'), 'utf8'));
  if (manifest.name !== config.manifest.name || manifest.version !== config.manifest.version) {
    throw new Error(`Release output must match ${config.manifest.name}@${config.manifest.version}.`);
  }
  if (!options.dryRun && (await getVersionState(manifest.name, manifest.version)) === 'published') {
    throw new Error(`${manifest.name}@${manifest.version} is already published; aborting.`);
  }
  if (!(await confirmPublication(manifest, options))) return cancel('Publish aborted.');
  await publish(manifest);
  if (!options.dryRun && !githubExists) {
    try {
      await publishGithubRelease(repoRoot, manifest.version);
    } catch (error) {
      throw new Error(
        `npm publication succeeded, but GitHub Release failed. Retry with pnpm release:publish --github-only.\n${error.message}`,
        { cause: error }
      );
    }
  }
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exit(1);
});
