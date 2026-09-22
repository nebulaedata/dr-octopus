/**
 * @author Codex
 * @description Reads GitHub publication state independently of the current checkout and release tags.
 */
import { execute } from '../apps/cli/src/process.ts';

/**
 * Checks repository access before interpreting a release 404 as absence; other failures remain errors.
 * @returns {Promise<'absent' | 'draft' | 'published'>}
 */
export async function getGithubPublicationState(
  root,
  version,
  { run = execute, request = fetch, token = process.env.GITHUB_TOKEN } = {}
) {
  if (!token) throw new Error('GITHUB_TOKEN is required (repository Contents: read and write).');
  const remote = await run('git', ['remote', 'get-url', 'origin'], root);
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remote);
  if (!match) throw new Error('origin must point to a GitHub repository over HTTPS or SSH.');
  const api = `https://api.github.com/repos/${match[1]}/${match[2]}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
  const repository = await request(api, { headers, signal: AbortSignal.timeout(30_000) });
  if (!repository.ok) throw new Error(`GitHub repository access failed (HTTP ${repository.status}).`);
  if (!(await repository.json()).permissions?.push) {
    throw new Error('GITHUB_TOKEN must have write access to the release repository.');
  }
  const release = await request(`${api}/releases/tags/v${encodeURIComponent(version)}`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (release.status === 404) return 'absent';
  if (!release.ok) throw new Error(`GitHub release lookup failed (HTTP ${release.status}).`);
  return (await release.json()).draft ? 'draft' : 'published';
}
