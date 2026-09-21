/**
 * @author Codex
 * @description Validates an existing GitHub release tag and creates its release through release-it without changing versions.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { execute } from '../apps/cli/src/process.ts';

const require = createRequire(import.meta.url);

/**
 * Checks credentials, clean source, and matching local/remote tags before npm publication.
 * Returns whether the GitHub release is already published so retries remain idempotent.
 */
export async function assertGithubReleaseReady(
  root,
  version,
  { run = execute, request = fetch, token = process.env.GITHUB_TOKEN } = {}
) {
  if (!token) throw new Error('GITHUB_TOKEN is required (repository Contents: read and write).');
  const remote = await run('git', ['remote', 'get-url', 'origin'], root);
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remote);
  if (!match) throw new Error('origin must point to a GitHub repository over HTTPS or SSH.');
  if (await run('git', ['status', '--porcelain'], root)) {
    throw new Error('Commit working-tree changes before publishing.');
  }
  const tag = `v${version}`;
  const head = await run('git', ['rev-parse', 'HEAD'], root);
  const tagged = await run('git', ['rev-parse', `refs/tags/${tag}^{commit}`], root);
  if (head !== tagged) throw new Error(`${tag} must point to HEAD; check out the release commit.`);
  const refs = await run('git', ['ls-remote', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`], root);
  const entries = new Map(
    refs
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [sha, ref] = line.split(/\s+/);
        return [ref, sha];
      })
  );
  if ((entries.get(`refs/tags/${tag}^{}`) || entries.get(`refs/tags/${tag}`)) !== head) {
    throw new Error(`Push ${tag} to origin before publishing; its remote commit must match HEAD.`);
  }
  const api = `https://api.github.com/repos/${match[1]}/${match[2]}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
  const repository = await request(api, { headers, signal: AbortSignal.timeout(30_000) });
  if (!repository.ok) throw new Error(`GitHub repository access failed (HTTP ${repository.status}).`);
  if (!(await repository.json()).permissions?.push) {
    throw new Error('GITHUB_TOKEN must have write access to the release repository.');
  }
  const release = await request(`${api}/releases/tags/${tag}`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (release.status === 404) return false;
  if (!release.ok) throw new Error(`GitHub release lookup failed (HTTP ${release.status}).`);
  if ((await release.json()).draft) throw new Error(`Resolve the existing draft release for ${tag} first.`);
  return true;
}

/**
 * Runs release-it against exactly the validated version tag, with npm and Git mutations disabled.
 */
export async function publishGithubRelease(root, version, run = execute) {
  const bin = join(dirname(require.resolve('release-it/package.json')), 'bin/release-it.js');
  await run(
    process.execPath,
    [
      bin,
      '--config',
      join(root, '.release-it.github.json'),
      '--ci',
      '--no-increment',
      `--git.tagMatch=v${version}`,
    ],
    root,
    'inherit',
    120_000
  );
}
