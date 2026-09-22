/**
 * @author Codex
 * @description Recreates only unpublished version tags at the current commit, with remote concurrency protection.
 */
import { execute } from '../apps/cli/src/process.ts';

/**
 * Prepares the current version after explicit continuation, rechecking both platforms before any Git mutation.
 * Published npm packages or GitHub releases pin the original tag; drafts must be resolved first.
 * Replaces the remote ref atomically with a lease rather than leaving a deletion gap on timeout.
 */
export async function resumeReleaseTag(root, version, { readState, run = execute }) {
  const ref = `refs/tags/v${version}`;
  if (await run('git', ['status', '--porcelain'], root)) {
    throw new Error('Commit working-tree changes before publishing.');
  }
  const head = await run('git', ['rev-parse', 'HEAD'], root);
  const local = await run('git', ['for-each-ref', '--format=%(objectname)', ref], root);
  const localCommit = local ? await run('git', ['rev-parse', `${ref}^{commit}`], root) : undefined;
  const remote = await run('git', ['ls-remote', 'origin', ref, `${ref}^{}`], root);
  const entries = new Map(
    remote
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [sha, name] = line.split(/\s+/);
        return [name, sha];
      })
  );
  const remoteObject = entries.get(ref);
  const remoteCommit = entries.get(`${ref}^{}`) || remoteObject;
  const state = await readState();
  if (state.npm === 'published') {
    throw new Error('The current version is now published to npm. Retry --resume to complete GitHub only.');
  }
  if (state.npm !== 'available' || !['absent', 'published', 'draft'].includes(state.github)) {
    throw new Error('Cannot establish publication state; release tags were not changed.');
  }
  if (state.github === 'draft') throw new Error('Resolve the existing draft release before continuing.');
  if (state.github === 'published') {
    if (localCommit !== head || remoteCommit !== head) {
      throw new Error(
        'The GitHub Release already pins another commit. Use --bump to publish the current code.'
      );
    }
    return;
  }
  if (
    (await run('git', ['rev-parse', 'HEAD'], root)) !== head ||
    (await run('git', ['status', '--porcelain'], root))
  ) {
    throw new Error('Source changed during preflight; retry with a clean working tree.');
  }
  if (localCommit !== head) {
    console.log(`→ Recreating v${version} at ${head} (not published to npm or GitHub).`);
    if (local) await run('git', ['update-ref', '-d', ref, local], root);
    await run(
      'git',
      ['-c', 'tag.gpgSign=false', 'tag', '-a', `v${version}`, '-m', `Release v${version}`, head],
      root
    );
  }
  if (remoteCommit !== head) {
    try {
      await run(
        'git',
        [
          '-c',
          'push.followTags=false',
          'push',
          `--force-with-lease=${ref}:${remoteObject ?? ''}`,
          'origin',
          `${ref}:${ref}`,
        ],
        root
      );
    } catch (error) {
      throw new Error(`Tag push failed; retry pnpm release:publish --resume.\n${error.message}`, {
        cause: error,
      });
    }
  }
  const verified = await run('git', ['ls-remote', 'origin', ref, `${ref}^{}`], root);
  const commits = new Map(
    verified
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [sha, name] = line.split(/\s+/);
        return [name, sha];
      })
  );
  if ((commits.get(`${ref}^{}`) || commits.get(ref)) !== head) {
    throw new Error('Remote tag verification failed; publication aborted. Retry --resume.');
  }
}
