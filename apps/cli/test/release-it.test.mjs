/**
 * @author Codex
 * @description Verifies version-only releases against isolated Git repositories and a local bare remote.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const repository = fileURLToPath(new URL('../../../', import.meta.url));
const releaseBin = join(dirname(require.resolve('release-it/package.json')), 'bin/release-it.js');
const rootManifest = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8'));

/**
 * Runs a real release command without allowing interactive credential prompts or external Git configuration.
 */
async function run(command, args, cwd, env) {
  const result = await execute(command, args, { cwd, env, timeout: 60_000 });
  return result.stdout.trim();
}

/**
 * Creates a committed workspace with an upstream that can only push into this test's temporary directory.
 */
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'octopus-release-it-'));
  t.after(async () => {
    assert.equal(dirname(root), resolve(tmpdir()));
    assert.match(basename(root), /^octopus-release-it-/);
    await rm(root, { recursive: true, force: true });
  });
  const worktree = join(root, 'workspace');
  const remote = join(root, 'remote.git');
  await mkdir(join(worktree, 'apps/cli'), { recursive: true });
  await writeFile(join(root, 'gitconfig'), '');
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_CONFIG_GLOBAL: join(root, 'gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
  };
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  env[pathKey] = join(repository, 'node_modules/.bin') + delimiter + (env[pathKey] ?? '');
  const config = JSON.parse(await readFile(join(repository, '.release-it.json'), 'utf8'));
  config.plugins = Object.fromEntries(
    Object.entries(config.plugins).map(([name, options]) => [
      pathToFileURL(require.resolve(name)).href,
      options,
    ])
  );
  const publication = JSON.parse(await readFile(join(repository, 'release.config.json'), 'utf8'));
  publication.manifest.version = '1.2.3';
  await mkdir(join(worktree, 'scripts'));
  const unchanged = {
    'scripts/validate-release-version.mjs': await readFile(
      join(repository, 'scripts/validate-release-version.mjs'),
      'utf8'
    ),
    '.prettierrc': await readFile(join(repository, '.prettierrc'), 'utf8'),
    '.editorconfig': await readFile(join(repository, '.editorconfig'), 'utf8'),
    'package.json': JSON.stringify(rootManifest) + '\r\n',
    'apps/cli/package.json': await readFile(join(repository, 'apps/cli/package.json'), 'utf8'),
    'pnpm-lock.yaml': 'lockfileVersion: "9.0"\r\nimporters: {}\r\n',
  };
  for (const [path, contents] of Object.entries(unchanged)) {
    await writeFile(join(worktree, path), contents);
  }
  await writeFile(join(worktree, '.release-it.json'), JSON.stringify(config));
  const publicationPath = join(worktree, 'release.config.json');
  await writeFile(publicationPath, JSON.stringify(publication, null, 2).replaceAll('\n', '\r\n') + '\r\n');
  /**
   * Limits Git commands to this fixture and its local remote.
   */
  const git = (...args) => run('git', args, worktree, env);
  await git('init', '--initial-branch=main');
  await git('config', 'user.name', 'Release Test');
  await git('config', 'user.email', 'release-test@example.invalid');
  await git('config', 'core.autocrlf', 'false');
  await git('config', 'core.hooksPath', join(root, 'no-hooks'));
  await git('add', '.');
  await git('commit', '-m', 'test: initialize release fixture');
  await git('init', '--bare', '--initial-branch=main', remote);
  await git('remote', 'add', 'origin', remote);
  await git('push', '--set-upstream', 'origin', 'main');
  /**
   * Uses the repository's actual script flags with the installed release-it CLI.
   */
  const release = (script, ...args) => {
    const [command, ...flags] = rootManifest.scripts[script].split(' ');
    assert.equal(command, 'release-it');
    return run(process.execPath, [releaseBin, ...flags, ...args, '--ci'], worktree, env);
  };
  return { worktree, remote, publication, publicationPath, unchanged, git, release };
}

test('release dry run leaves version, commit and local/remote tags untouched', async (t) => {
  const f = await fixture(t);
  const before = await readFile(f.publicationPath, 'utf8');
  const head = await f.git('rev-parse', 'HEAD');
  await f.release('release:dry', 'patch');
  assert.equal(await readFile(f.publicationPath, 'utf8'), before);
  assert.equal(await f.git('rev-parse', 'HEAD'), head);
  assert.equal(await f.git('tag', '--list'), '');
  assert.equal(await f.git('--git-dir', f.remote, 'tag', '--list'), '');
  assert.equal(await f.git('--git-dir', f.remote, 'rev-parse', 'main'), head);
  assert.equal(await f.git('status', '--porcelain'), '');
});

test('release bumps only the publication version and pushes annotated stable and prerelease tags', async (t) => {
  const f = await fixture(t);
  await f.release('release', 'patch');
  assert.deepEqual(JSON.parse(await readFile(f.publicationPath, 'utf8')), {
    ...f.publication,
    manifest: { ...f.publication.manifest, version: '1.2.4' },
  });
  assert.equal(await f.git('log', '-1', '--format=%s'), 'chore(release): v1.2.4');
  assert.equal(
    await f.git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'),
    'release.config.json'
  );
  assert.equal(await f.git('cat-file', '-t', 'refs/tags/v1.2.4'), 'tag');
  assert.equal(
    await f.git('--git-dir', f.remote, 'rev-parse', 'v1.2.4^{}'),
    await f.git('rev-parse', 'HEAD')
  );
  assert.doesNotMatch(await readFile(f.publicationPath, 'utf8'), /(?<!\r)\n/);
  for (const [path, contents] of Object.entries(f.unchanged)) {
    assert.equal(await readFile(join(f.worktree, path), 'utf8'), contents, path);
  }
  await f.release('release', 'minor', '--preRelease=beta');
  assert.equal(JSON.parse(await readFile(f.publicationPath, 'utf8')).manifest.version, '1.3.0-beta.0');
  assert.equal(
    await f.git('--git-dir', f.remote, 'rev-parse', 'v1.3.0-beta.0^{}'),
    await f.git('rev-parse', 'HEAD')
  );
  assert.equal(await f.git('--git-dir', f.remote, 'rev-parse', 'main'), await f.git('rev-parse', 'HEAD'));
  assert.equal(await f.git('status', '--porcelain'), '');
});

test('release refuses tracked local changes before changing the publication version or pushing', async (t) => {
  const f = await fixture(t);
  const before = await readFile(f.publicationPath, 'utf8');
  const head = await f.git('rev-parse', 'HEAD');
  const edited = f.unchanged['package.json'] + ' ';
  await writeFile(join(f.worktree, 'package.json'), edited);
  await assert.rejects(f.release('release', 'patch'), /Working dir must be clean/);
  assert.equal(await readFile(f.publicationPath, 'utf8'), before);
  assert.equal(await readFile(join(f.worktree, 'package.json'), 'utf8'), edited);
  assert.equal(await f.git('rev-parse', 'HEAD'), head);
  assert.equal(await f.git('tag', '--list'), '');
  assert.equal(await f.git('--git-dir', f.remote, 'rev-parse', 'main'), head);
});

test('selecting the current version fails before changing files, commits or tags', async (t) => {
  const f = await fixture(t);
  await f.git('tag', '-a', 'v1.2.3', '-m', 'Release v1.2.3');
  await f.git('push', 'origin', 'refs/tags/v1.2.3');
  const before = await readFile(f.publicationPath, 'utf8');
  const head = await f.git('rev-parse', 'HEAD');
  const tag = await f.git('rev-parse', 'refs/tags/v1.2.3');
  await assert.rejects(f.release('release', '1.2.3'), /Select a new version instead of 1.2.3/);
  assert.equal(await readFile(f.publicationPath, 'utf8'), before);
  assert.equal(await f.git('status', '--porcelain'), '');
  assert.equal(await f.git('rev-parse', 'HEAD'), head);
  assert.equal(await f.git('rev-parse', 'refs/tags/v1.2.3'), tag);
  assert.equal(await f.git('--git-dir', f.remote, 'rev-parse', 'main'), head);
  assert.equal(await f.git('--git-dir', f.remote, 'rev-parse', 'refs/tags/v1.2.3'), tag);
});
