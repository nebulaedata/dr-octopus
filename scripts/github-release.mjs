/**
 * @author Codex
 * @description Validates an existing GitHub release tag and creates its release through release-it without changing versions.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { execute } from '../apps/cli/src/process.ts';
import { getGithubPublicationState } from './github-publication-state.mjs';

const require = createRequire(import.meta.url);

/**
 * Checks credentials, clean source, and matching local/remote tags before npm publication.
 * Optionally resumes an interrupted tag push, without replacing existing remote tags.
 * Returns whether the GitHub release is already published so retries remain idempotent.
 */
export async function assertGithubReleaseReady(
  root,
  version,
  {
    run = execute,
    request = fetch,
    token = process.env.GITHUB_TOKEN,
    pushMissingTag = false,
    requireHead = true,
  } = {}
) {
  if (!token) throw new Error('GITHUB_TOKEN is required (repository Contents: read and write).');
  if (await run('git', ['status', '--porcelain'], root)) {
    throw new Error('Commit working-tree changes before publishing.');
  }
  const tag = `v${version}`;
  const head = await run('git', ['rev-parse', 'HEAD'], root);
  const tagged = await run('git', ['rev-parse', `refs/tags/${tag}^{commit}`], root);
  if (requireHead && head !== tagged)
    throw new Error(`${tag} must point to HEAD; check out the release commit.`);
  /**
   * Resolves annotated and lightweight remote tags, keeping missing refs distinct from conflicts.
   */
  async function remoteCommit() {
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
    return entries.get(`refs/tags/${tag}^{}`) || entries.get(`refs/tags/${tag}`);
  }
  const remoteHead = await remoteCommit();
  if (remoteHead && remoteHead !== tagged) {
    throw new Error(`Remote ${tag} points to a different commit; resolve the conflict before publishing.`);
  }
  if (!remoteHead && !pushMissingTag) {
    throw new Error(`Push ${tag} to origin before publishing; its remote commit must match HEAD.`);
  }
  const state = await getGithubPublicationState(root, version, { run, request, token });
  if (state === 'draft') throw new Error(`Resolve the existing draft release for ${tag} first.`);
  const exists = state === 'published';
  if (!remoteHead) {
    console.log(`→ Resuming release: pushing missing ${tag} to origin...`);
    try {
      await run(
        'git',
        ['-c', 'push.followTags=false', 'push', 'origin', `refs/tags/${tag}:refs/tags/${tag}`],
        root
      );
    } catch (error) {
      throw new Error(
        `Could not push ${tag}. Fix the Git push failure and retry pnpm release:publish.\n${error.message}`,
        { cause: error }
      );
    }
    if ((await remoteCommit()) !== tagged) {
      throw new Error(`Remote ${tag} did not match HEAD after pushing; publication aborted.`);
    }
  }
  return exists;
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
