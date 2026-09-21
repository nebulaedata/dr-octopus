/**
 * @author longlongago2
 * @description Publishes the assembled npm release: verifies authentication, bumps the version when occupied, builds, and publishes.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { execute, pnpmCommand } from '../apps/cli/src/process.ts';
import { readReleaseConfig } from '../apps/cli/src/distribution/config.ts';
import { findConfiguration } from '../apps/cli/src/distribution/location.ts';

const DEFAULT_REGISTRY = 'https://registry.npmjs.org/';
const BUILD_TIMEOUT = 900_000;
const PUBLISH_TIMEOUT = 600_000;
const BUMP_TIMEOUT = 120_000;

const USAGE = `Usage: publish-release.mjs [options]

Options:
  --registry <url>   Registry to publish to (default: ${DEFAULT_REGISTRY})
  --otp <code>       One-time password for accounts with 2FA publishing
  --bump             Always run release-it to bump the version first
  --dry-run          Run npm publish --dry-run without uploading
  --skip-build       Reuse the existing release/ directory
  -y, --yes          Skip the interactive confirmation
  -h, --help         Show this help`;

/**
 * Parses CLI flags, accepting both "--flag value" and "--flag=value" forms.
 * @returns {{registry: string, otp: string | undefined, bump: boolean, dryRun: boolean, skipBuild: boolean, yes: boolean, help: boolean}}
 */
function parseArgs(argv) {
  const options = {
    registry: DEFAULT_REGISTRY,
    otp: undefined,
    bump: false,
    dryRun: false,
    skipBuild: false,
    yes: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const separator = arg.indexOf('=');
    const flag = separator === -1 ? arg : arg.slice(0, separator);
    const inline = separator === -1 ? undefined : arg.slice(separator + 1);
    if (flag === '--registry' || flag === '--otp') {
      const value = inline !== undefined ? inline : argv[++i];
      if (value === undefined) throw new Error(`Missing value for ${flag}.`);
      if (flag === '--registry') options.registry = value;
      else options.otp = value;
    } else if (flag === '--bump') {
      options.bump = true;
    } else if (flag === '--dry-run') {
      options.dryRun = true;
    } else if (flag === '--skip-build') {
      options.skipBuild = true;
    } else if (flag === '--yes' || flag === '-y') {
      options.yes = true;
    } else if (flag === '--help' || flag === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}.\n\n${USAGE}`);
    }
  }
  if (!/^https?:\/\//.test(options.registry)) {
    throw new Error(`Invalid registry URL: ${options.registry}`);
  }
  return options;
}

/**
 * Resolves npm's JS entry on Windows so arguments never pass through cmd.exe quoting.
 * @param {string} cwd Directory used to probe for the npm shim.
 * @returns {Promise<{command: string, args: string[]}>}
 */
async function npmCommand(cwd) {
  if (process.platform !== 'win32') {
    return { command: 'npm', args: [] };
  }
  const { access } = await import('node:fs/promises');
  const paths = (await execute('where.exe', ['npm'], cwd)).split(/\r?\n/);
  for (const path of paths) {
    for (const entry of [
      join(dirname(path), 'node_modules/npm/bin/npm-cli.js'),
      join(dirname(path), 'npm-cli.js'),
    ]) {
      try {
        await access(entry);
        return { command: process.execPath, args: [entry] };
      } catch {
        /* Try the next standard npm shim layout. */
      }
    }
    if (path.endsWith('.exe')) {
      return { command: path, args: [] };
    }
  }
  throw new Error('npm was not found. Install Node.js 22.19+, which bundles npm.');
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log(USAGE);
  process.exit(0);
}

const configPath = findConfiguration(dirname(fileURLToPath(import.meta.url)), 'release.config.json');
if (!configPath) {
  throw new Error('release.config.json was not found above the publish script.');
}
const repoRoot = dirname(configPath);
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
  try {
    const published = await execute(
      npm.command,
      [...npm.args, 'view', `${name}@${version}`, 'version', `--registry=${options.registry}`],
      repoRoot
    );
    if (published === version) {
      console.log(`→ ${name}@${version} is already published on ${options.registry}`);
      return 'published';
    }
    return 'available';
  } catch (error) {
    if (error.message.includes('E404')) {
      console.log(`→ ${name}@${version} not found on ${options.registry} (new version)`);
      return 'available';
    }
    console.warn(`⚠ Registry check failed (${error.message.split('\n')[0]}); continuing.`);
    return 'available';
  }
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
 * Asks for a final confirmation unless --yes or --dry-run was passed, since npm publish is irreversible.
 * @param {{name: string, version: string}} manifest Built release manifest.
 */
async function confirmPublish(manifest) {
  if (options.yes || options.dryRun) return;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(
      `\nPublish ${manifest.name}@${manifest.version} to ${options.registry}? [y/N] `
    );
    if (!/^y(?:es)?$/i.test(answer.trim())) {
      console.log('Publish aborted.');
      process.exit(0);
    }
  } finally {
    rl.close();
  }
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
 * Verifies authentication, bumps the version when it is already taken, builds, confirms, and publishes.
 */
async function main() {
  await assertAuthenticated();
  const state = await getVersionState(config.manifest.name, config.manifest.version);
  if (options.dryRun) {
    if (state === 'published') {
      console.warn('⚠ Version already published; dry-run skips the version bump.');
    }
  } else if (state === 'published' || options.bump) {
    await bumpVersion();
  }
  if (!options.skipBuild) {
    console.log('→ Building release (pnpm release:build)...');
    await execute(pnpm.command, [...pnpm.args, 'run', 'release:build'], repoRoot, 'inherit', BUILD_TIMEOUT);
  }
  const manifest = JSON.parse(await readFile(join(release, 'package.json'), 'utf8'));
  if (manifest.name !== config.manifest.name) {
    throw new Error(`Release output is not a release of ${config.manifest.name}.`);
  }
  if ((await getVersionState(manifest.name, manifest.version)) === 'published') {
    throw new Error(`${manifest.name}@${manifest.version} is already published; aborting.`);
  }
  await confirmPublish(manifest);
  await publish(manifest);
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exit(1);
});
