/**
 * @author Codex
 * @description Exercises unpublished tag recovery, timeouts, and concurrent pushes against isolated local remotes.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { resumeReleaseTag } from '../../../scripts/resume-release-tag.mjs';

/**
 * Creates a clean working tree with an old published Git tag but no npm or GitHub publication.
 */
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'octopus-resume-tag-'));
  t.after(() => {
    assert.equal(dirname(root), resolve(tmpdir()));
    rmSync(root, { recursive: true, force: true });
  });
  const workspace = join(root, 'workspace');
  const remote = join(root, 'remote.git');
  mkdirSync(workspace);
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(root, 'no-config'),
    GIT_TERMINAL_PROMPT: '0',
  };
  /**
   * Runs Git only inside the fixture, with external configuration and hooks disabled.
   */
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: workspace,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Release fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'core.hooksPath', join(root, 'no-hooks'));
  writeFileSync(join(workspace, 'release.config.json'), '{"manifest":{"version":"0.0.9"}}');
  git('add', '.');
  git('commit', '-m', 'old release');
  git('tag', '-a', 'v0.0.9', '-m', 'Release v0.0.9');
  git('init', '--bare', remote);
  git('remote', 'add', 'origin', remote);
  git('push', '-u', 'origin', 'main', 'refs/tags/v0.0.9');
  const oldTag = git('rev-parse', 'refs/tags/v0.0.9');
  git('commit', '--allow-empty', '-m', 'fix publication');
  git('tag', '-a', 'unrelated', '-m', 'Do not push');
  git('config', 'push.followTags', 'true');
  const head = git('rev-parse', 'HEAD');
  return { root, workspace, remote, git, oldTag, head };
}

/**
 * Models a version that neither publication service has accepted.
 */
async function unpublished() {
  return { npm: 'available', github: 'absent' };
}

test('continuing an unpublished version replaces only its tag at HEAD and is idempotent', async (t) => {
  const f = fixture(t);
  let pushes = 0;
  const options = {
    readState: unpublished,
    run: async (_command, args) => {
      if (args.includes('push')) pushes += 1;
      return f.git(...args);
    },
  };
  await resumeReleaseTag(f.workspace, '0.0.9', options);
  const tag = f.git('rev-parse', 'refs/tags/v0.0.9');
  assert.notEqual(tag, f.oldTag);
  assert.equal(f.git('rev-parse', 'v0.0.9^{}'), f.head);
  assert.equal(f.git('--git-dir', f.remote, 'rev-parse', 'v0.0.9^{}'), f.head);
  assert.equal(f.git('--git-dir', f.remote, 'tag', '--list'), 'v0.0.9');
  assert.equal(f.git('status', '--porcelain'), '');
  await resumeReleaseTag(f.workspace, '0.0.9', options);
  assert.equal(f.git('rev-parse', 'refs/tags/v0.0.9'), tag);
  assert.equal(pushes, 1);
});

test('first publication creates a missing local and remote version tag', async (t) => {
  const f = fixture(t);
  f.git('push', 'origin', ':refs/tags/v0.0.9');
  f.git('tag', '-d', 'v0.0.9');
  await resumeReleaseTag(f.workspace, '0.0.9', {
    readState: unpublished,
    run: async (_cmd, args) => f.git(...args),
  });
  assert.equal(f.git('--git-dir', f.remote, 'rev-parse', 'v0.0.9^{}'), f.head);
});

test('timeouts before and after remote acceptance can resume without bumping or rolling back', async (t) => {
  for (const accepted of [false, true]) {
    const f = fixture(t);
    let pushes = 0;
    const options = {
      readState: unpublished,
      run: async (_command, args) => {
        if (args.includes('push')) {
          pushes += 1;
          if (pushes === 1) {
            if (accepted) f.git(...args);
            throw new Error('push timed out');
          }
        }
        return f.git(...args);
      },
    };
    await assert.rejects(
      resumeReleaseTag(f.workspace, '0.0.9', options),
      /retry pnpm release:publish --resume/
    );
    await resumeReleaseTag(f.workspace, '0.0.9', options);
    assert.equal(pushes, accepted ? 1 : 2);
    assert.equal(f.git('--git-dir', f.remote, 'rev-parse', 'v0.0.9^{}'), f.head);
    assert.equal(f.git('status', '--porcelain'), '');
  }
});

test('rechecking publication state prevents replacement after publication or lookup failure', async (t) => {
  const f = fixture(t);
  for (const readState of [
    async () => ({ npm: 'published', github: 'absent' }),
    async () => ({ npm: 'available', github: 'published' }),
    async () => ({ npm: 'available', github: 'draft' }),
    async () => ({ npm: 'unknown', github: 'absent' }),
    async () => {
      throw new Error('network unavailable');
    },
  ]) {
    await assert.rejects(
      resumeReleaseTag(f.workspace, '0.0.9', {
        readState,
        run: async (_cmd, args) => f.git(...args),
      })
    );
    assert.equal(f.git('rev-parse', 'refs/tags/v0.0.9'), f.oldTag);
    assert.equal(f.git('--git-dir', f.remote, 'rev-parse', 'refs/tags/v0.0.9'), f.oldTag);
  }
});

test('a concurrent remote tag update fails the lease instead of overwriting another publisher', async (t) => {
  const f = fixture(t);
  const otherCommit = f.git('rev-parse', 'HEAD^');
  await assert.rejects(
    resumeReleaseTag(f.workspace, '0.0.9', {
      readState: unpublished,
      run: async (_command, args) => {
        if (args.includes('push'))
          f.git('--git-dir', f.remote, 'update-ref', 'refs/tags/v0.0.9', otherCommit);
        return f.git(...args);
      },
    }),
    /Tag push failed/
  );
  assert.equal(f.git('--git-dir', f.remote, 'rev-parse', 'refs/tags/v0.0.9'), otherCommit);
});

test('dirty source cannot reset tags', async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.workspace, 'uncommitted.txt'), 'changed');
  await assert.rejects(
    resumeReleaseTag(f.workspace, '0.0.9', {
      readState: unpublished,
      run: async (_cmd, args) => f.git(...args),
    }),
    /Commit working-tree/
  );
  assert.equal(f.git('rev-parse', 'refs/tags/v0.0.9'), f.oldTag);
});
