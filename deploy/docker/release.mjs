/**
 * @author Codex
 * @description Validates Docker release identity, immutable tags and stable promotion without workspace dependencies.
 */
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repository = 'nebulaedata01/dr-octopus';
export const image = `docker.io/${repository}`;
const numeric = '(0|[1-9][0-9]*)';
const versionPattern = new RegExp(
  `^${numeric}\\.${numeric}\\.${numeric}(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$`
);

/**
 * Accepts exact npm versions representable as Docker tags and an explicit image-only revision.
 */
export function releaseIdentity(tag, revision = '0') {
  const version = tag?.startsWith('v') ? tag.slice(1) : '';
  const match = version.match(versionPattern);
  if (!match || match[0] !== version || !/^(0|[1-9][0-9]*)$/.test(revision) || revision.trim() !== revision)
    throw new Error('Use vMAJOR.MINOR.PATCH[-prerelease] and a nonnegative image revision.');
  if (match[4]?.split('.').some((part) => /^0[0-9]+$/.test(part)))
    throw new Error('Numeric prerelease identifiers cannot have leading zeroes.');
  const imageTag = `${version}${revision === '0' ? '' : `-r${revision}`}`;
  if (imageTag.length > 128) throw new Error('Docker image tag exceeds 128 characters.');
  return { tag, version, revision, imageTag, prerelease: Boolean(match[4]) };
}

/**
 * Allows only a strictly newer stable application version or image revision to replace latest.
 */
export function shouldPromote(candidate, current) {
  if (candidate.prerelease) return false;
  if (!current) return true;
  const previous = releaseIdentity(`v${current.version}`, current.revision);
  if (previous.prerelease)
    throw new Error('latest unexpectedly references a prerelease; repair it explicitly.');
  const next = [...candidate.version.split('.'), candidate.revision].map(BigInt);
  const old = [...previous.version.split('.'), previous.revision].map(BigInt);
  for (let i = 0; i < next.length; i++) {
    if (next[i] !== old[i]) return next[i] > old[i];
  }
  return false;
}

/**
 * Resolves a public Docker Hub manifest; only an explicit 404 means absent, never a transport/auth error.
 */
export async function registryDigest(tag, request = fetch) {
  const tokenResponse = await request(
    `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repository}:pull`,
    { signal: AbortSignal.timeout(30_000) }
  );
  if (!tokenResponse.ok) throw new Error(`Docker Hub token request failed: ${tokenResponse.status}`);
  const { token } = await tokenResponse.json();
  if (!token) throw new Error('Docker Hub did not return a pull token.');
  const response = await request(
    `https://registry-1.docker.io/v2/${repository}/manifests/${encodeURIComponent(tag)}`,
    {
      method: 'HEAD',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept:
          'application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json',
      },
      signal: AbortSignal.timeout(30_000),
    }
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Docker Hub manifest lookup failed: ${response.status}`);
  const digest = response.headers.get('docker-content-digest');
  if (!/^sha256:[a-f0-9]{64}$/.test(digest ?? '')) throw new Error('Docker Hub returned an invalid digest.');
  return digest;
}

/**
 * Writes a minimal installer with the exact tested image tag; callers archive only this directory.
 */
export function prepareInstaller(source, target, identity) {
  mkdirSync(target, { recursive: true });
  for (const name of ['compose.yaml', 'README.md', 'README.zh-CN.md'])
    copyFileSync(resolve(source, name), resolve(target, name));
  const example = readFileSync(resolve(source, '.env.example'), 'utf8');
  if (!/^IMAGE_TAG=.+$/m.test(example)) throw new Error('Installer template has no IMAGE_TAG.');
  writeFileSync(
    resolve(target, '.env.example'),
    example.replace(/^IMAGE_TAG=[^\r\n]+/m, `IMAGE_TAG=${identity.imageTag}`)
  );
}

/**
 * Runs Docker with literal arguments, preserving failures and avoiding shell interpretation.
 */
function docker(...args) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    timeout: 600_000,
  }).trim();
}

/**
 * Exposes validated single-line values to later workflow steps.
 */
function output(values) {
  for (const [key, value] of Object.entries(values))
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

/**
 * Prepares release metadata and installer files; registry writes belong to the workflow.
 */
async function main(command) {
  const identity = releaseIdentity(process.env.RELEASE_TAG, process.env.IMAGE_REVISION ?? '0');
  const reference = `${image}:${identity.imageTag}`;
  if (command === 'prepare') {
    const config = JSON.parse(readFileSync('release.config.json', 'utf8'));
    if (config.manifest.name !== 'dr-octopus' || config.manifest.version !== identity.version)
      throw new Error('Release tag does not match release.config.json.');
    const response = await fetch(
      `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/releases/tags/${encodeURIComponent(identity.tag)}`,
      {
        headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(30_000),
      }
    );
    if (!response.ok) throw new Error(`Published GitHub Release lookup failed: ${response.status}`);
    const release = await response.json();
    if (release.draft || !release.published_at || release.tag_name !== identity.tag)
      throw new Error('A published matching GitHub Release is required.');
    const digest = await registryDigest(identity.imageTag);
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    output({
      version: identity.version,
      image_tag: identity.imageTag,
      reference,
      commit,
      digest: digest ?? '',
      prerelease: identity.prerelease || release.prerelease,
    });
  } else if (command === 'check-tag') {
    // The workflow serializes this repository; recheck immediately before pushing to catch external publishers.
    if (await registryDigest(identity.imageTag))
      throw new Error('Exact image tag already exists; rerun to reuse it instead of overwriting.');
  } else if (command === 'installer') {
    prepareInstaller('deploy/docker', process.env.INSTALLER_DIR, identity);
  } else if (command === 'latest-plan') {
    if (process.env.RELEASE_PRERELEASE === 'true' || identity.prerelease) {
      output({ promote: false });
      return;
    }
    const digest = await registryDigest('latest');
    let current;
    if (digest) {
      const pinned = `${image}@${digest}`;
      docker('pull', pinned);
      const [existing] = JSON.parse(docker('image', 'inspect', pinned));
      const labels = existing.Config.Labels ?? {};
      current = {
        version: labels['org.opencontainers.image.version'],
        revision: labels['com.nebulaedata.dr-octopus.image-revision'],
      };
      if (current.revision === undefined) throw new Error('latest is missing image revision metadata.');
    }
    output({ promote: shouldPromote(identity, current), reference: `${image}:latest` });
  } else throw new Error(`Unknown release command: ${command}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
