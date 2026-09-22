/**
 * @author Codex
 * @description Checks GitHub release preflight failures and release-it execution without publishing to external services.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertGithubReleaseReady, publishGithubRelease } from '../../../scripts/github-release.mjs';

/**
 * Supplies deterministic Git and HTTP responses without contacting a remote.
 */
function fixture(overrides = {}) {
  return {
    token: 'fixture-token',
    run: async (_command, args) => {
      if (args[0] === 'remote') return 'git@github.com:example/octopus.git';
      if (args[0] === 'status') return '';
      if (args[0] === 'rev-parse') return 'abc123';
      if (args[0] === 'ls-remote') return 'tag123\trefs/tags/v1.2.3\nabc123\trefs/tags/v1.2.3^{}';
      throw new Error(`Unexpected command: ${args}`);
    },
    request: async (url) =>
      url.includes('/releases/')
        ? { status: 404 }
        : { ok: true, json: async () => ({ permissions: { push: true } }) },
    ...overrides,
  };
}

test('preflight requires credentials and matching remote tags before publication', async () => {
  assert.equal(await assertGithubReleaseReady('.', '1.2.3', fixture()), false);
  await assert.rejects(assertGithubReleaseReady('.', '1.2.3', fixture({ token: '' })), /GITHUB_TOKEN/);
  const defaults = fixture();
  await assert.rejects(
    assertGithubReleaseReady(
      '.',
      '1.2.3',
      fixture({
        run: async (command, args) => (args[0] === 'ls-remote' ? '' : defaults.run(command, args)),
      })
    ),
    /Push v1.2.3/
  );
  await assert.rejects(
    assertGithubReleaseReady(
      '.',
      '1.2.3',
      fixture({
        run: async (command, args) => (args[0] === 'status' ? ' M source.ts' : defaults.run(command, args)),
      })
    ),
    /Commit working-tree/
  );
});

test('preflight recognizes published releases and fails closed on API errors or drafts', async () => {
  const defaults = fixture();
  for (const [response, expected] of [
    [{ ok: true, json: async () => ({ draft: false }) }, true],
    [{ ok: true, json: async () => ({ draft: true }) }, /draft release/],
    [{ ok: false, status: 403 }, /HTTP 403/],
  ]) {
    const options = fixture({
      request: async (url) => (url.includes('/releases/') ? response : defaults.request(url)),
    });
    const result = assertGithubReleaseReady('.', '1.2.3', options);
    if (expected === true) assert.equal(await result, true);
    else await assert.rejects(result, expected);
  }
});

test('release-it dry run uses the exact existing prerelease tag without changing files or tags', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'octopus-github-release-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Release fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  copyFileSync(
    new URL('../../../.release-it.github.json', import.meta.url),
    join(root, '.release-it.github.json')
  );
  writeFileSync(join(root, 'package.json'), '{"name":"fixture","private":true,"version":"0.0.0"}');
  git('add', '.');
  git('commit', '-m', 'fixture');
  git('tag', 'v1.2.3-beta.0');
  git('remote', 'add', 'origin', 'https://github.com/example/octopus.git');
  const head = git('rev-parse', 'HEAD');
  await publishGithubRelease(root, '1.2.3-beta.0', async (command, args, cwd) => {
    const output = execFileSync(command, [...args, '--dry-run'], {
      cwd,
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, GITHUB_TOKEN: 'fixture-not-a-real-token' },
    });
    assert.match(output, /v1\.2\.3-beta\.0/);
    assert.ok(output.includes('https://github.com/example/octopus/releases/tag/v1.2.3-beta.0'));
  });
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.equal(git('status', '--porcelain'), '');
  assert.equal(git('tag', '--list'), 'v1.2.3-beta.0');
});

test('preflight resumes a missing tag push and a second attempt is read-only', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'octopus-tag-retry-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Release fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('commit', '--allow-empty', '-m', 'release fixture');
  git('tag', '-a', 'v1.2.3', '-m', 'Release v1.2.3');
  git('tag', '-a', 'unrelated', '-m', 'Do not push');
  git('config', 'push.followTags', 'true');
  const remote = join(root, 'remote.git');
  git('init', '--bare', remote);
  git('remote', 'add', 'origin', remote);
  let pushes = 0;
  const options = fixture({
    pushMissingTag: true,
    run: async (_command, args) => {
      if (args[0] === 'remote') return 'https://github.com/example/octopus.git';
      // The bare remote is inside the fixture; ignore its untracked directory.
      if (args[0] === 'status') return '';
      if (args.includes('push')) pushes += 1;
      return git(...args);
    },
  });
  assert.equal(await assertGithubReleaseReady(root, '1.2.3', options), false);
  assert.equal(await assertGithubReleaseReady(root, '1.2.3', options), false);
  assert.equal(pushes, 1);
  assert.equal(git('--git-dir', remote, 'rev-parse', 'v1.2.3^{}'), git('rev-parse', 'HEAD'));
  assert.equal(git('--git-dir', remote, 'tag', '--list'), 'v1.2.3');
});

test('tag recovery refuses conflicts, API failures and unverified pushes', async () => {
  const defaults = fixture();
  for (const scenario of ['conflict', 'local-mismatch', 'dirty', 'api', 'push-failure', 'not-visible']) {
    let pushes = 0;
    const options = fixture({
      pushMissingTag: true,
      run: async (command, args) => {
        if (args[0] === 'status' && scenario === 'dirty') return ' M source.ts';
        if (args[0] === 'rev-parse' && args[1] !== 'HEAD' && scenario === 'local-mismatch') return 'other';
        if (args[0] === 'ls-remote') return scenario === 'conflict' ? 'other\trefs/tags/v1.2.3' : '';
        if (args.includes('push')) {
          pushes += 1;
          if (scenario === 'push-failure') throw new Error('network unavailable');
          return '';
        }
        return defaults.run(command, args);
      },
      request: scenario === 'api' ? async () => ({ ok: false, status: 403 }) : defaults.request,
    });
    const errors = {
      conflict: /different commit/,
      'local-mismatch': /must point to HEAD/,
      dirty: /Commit working-tree/,
      api: /HTTP 403/,
      'push-failure': /retry pnpm release:publish/,
      'not-visible': /did not match HEAD after pushing/,
    };
    await assert.rejects(assertGithubReleaseReady('.', '1.2.3', options), errors[scenario]);
    assert.equal(pushes, ['push-failure', 'not-visible'].includes(scenario) ? 1 : 0);
  }
});
