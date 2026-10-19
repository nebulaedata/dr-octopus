/**
 * @author Codex
 * @description Verifies version-only releases against isolated Git repositories and a local bare remote.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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
  await mkdir(join(worktree, 'apps/executor'), { recursive: true });
  await symlink(
    join(repository, 'node_modules'),
    join(worktree, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
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
      name.startsWith('.') ? name : pathToFileURL(require.resolve(name)).href,
      options,
    ])
  );
  const publication = JSON.parse(await readFile(join(repository, 'release.config.json'), 'utf8'));
  publication.manifest.version = '1.2.3';
  await mkdir(join(worktree, 'scripts'));
  const unchanged = {
    '.gitignore': 'node_modules/\r\n',
    'scripts/validate-release-version.mjs': await readFile(
      join(repository, 'scripts/validate-release-version.mjs'),
      'utf8'
    ),
    '.prettierrc': await readFile(join(repository, '.prettierrc'), 'utf8'),
    'scripts/bump-release.mjs': await readFile(join(repository, 'scripts/bump-release.mjs'), 'utf8'),
    'scripts/executor-release-plugin.mjs': await readFile(
      join(repository, 'scripts/executor-release-plugin.mjs'),
      'utf8'
    ),
    'scripts/release-versions.mjs': await readFile(join(repository, 'scripts/release-versions.mjs'), 'utf8'),
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
  const executorPath = join(worktree, 'apps/executor/package.json');
  const executor =
    '{\r\n  "name": "@octopus/executor",\r\n  "version": "0.4.5",\r\n  "private": true\r\n}\r\n';
  await writeFile(executorPath, executor);
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
  /**
   * Uses the same child entrypoint as the unified publisher without contacting npm or GitHub.
   */
  const bump = (increment, executorIncrement) =>
    run(
      process.execPath,
      [
        join(worktree, 'scripts/bump-release.mjs'),
        '--increment',
        increment,
        '--executor-increment',
        executorIncrement,
      ],
      worktree,
      env
    );
  return {
    worktree,
    remote,
    publication,
    publicationPath,
    executorPath,
    executor,
    unchanged,
    git,
    release,
    bump,
    env,
  };
}

test('release dry run leaves version, commit and local/remote tags untouched', async (t) => {
  const f = await fixture(t);
  const before = await readFile(f.publicationPath, 'utf8');
  const head = await f.git('rev-parse', 'HEAD');
  await f.release('release:dry', 'patch');
  assert.equal(await readFile(f.publicationPath, 'utf8'), before);
  assert.equal(await readFile(f.executorPath, 'utf8'), f.executor);
  assert.equal(await f.git('rev-parse', 'HEAD'), head);
  assert.equal(await f.git('tag', '--list'), '');
  assert.equal(await f.git('--git-dir', f.remote, 'tag', '--list'), '');
  assert.equal(await f.git('--git-dir', f.remote, 'rev-parse', 'main'), head);
  assert.equal(await f.git('status', '--porcelain'), '');
});

test('release commits independent repository and Executor versions together and pushes their exact annotated tag', async (t) => {
  const f = await fixture(t);
  await f.release('release', 'patch');
  assert.deepEqual(JSON.parse(await readFile(f.publicationPath, 'utf8')), {
    ...f.publication,
    manifest: { ...f.publication.manifest, version: '1.2.4' },
  });
  assert.equal(await f.git('log', '-1', '--format=%s'), 'chore(release): v1.2.4');
  assert.equal(
    await f.git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'),
    'apps/executor/package.json\nrelease.config.json'
  );
  assert.equal(JSON.parse(await readFile(f.executorPath, 'utf8')).version, '0.4.6');
  assert.equal(await f.git('cat-file', '-t', 'refs/tags/v1.2.4'), 'tag');
  assert.equal(
    await f.git('--git-dir', f.remote, 'rev-parse', 'v1.2.4^{}'),
    await f.git('rev-parse', 'HEAD')
  );
  assert.doesNotMatch(await readFile(f.publicationPath, 'utf8'), /(?<!\r)\n/);
  for (const [path, contents] of Object.entries(f.unchanged)) {
    assert.equal(await readFile(join(f.worktree, path), 'utf8'), contents, path);
  }
  await f.bump('1.3.0-beta.0', 'minor');
  assert.equal(JSON.parse(await readFile(f.publicationPath, 'utf8')).manifest.version, '1.3.0-beta.0');
  assert.equal(JSON.parse(await readFile(f.executorPath, 'utf8')).version, '0.5.0');
  assert.equal(
    await f.git('--git-dir', f.remote, 'rev-parse', 'v1.3.0-beta.0^{}'),
    await f.git('rev-parse', 'HEAD')
  );
  assert.equal(await f.git('--git-dir', f.remote, 'rev-parse', 'main'), await f.git('rev-parse', 'HEAD'));
  assert.equal(await f.git('status', '--porcelain'), '');
  assert.equal(JSON.parse(await f.git('show', 'v1.3.0-beta.0:apps/executor/package.json')).version, '0.5.0');
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
  await assert.rejects(f.release('release', '1.2.3'), /Select a new version greater than 1.2.3/);
  assert.equal(await readFile(f.publicationPath, 'utf8'), before);
  assert.equal(await f.git('status', '--porcelain'), '');
  assert.equal(await f.git('rev-parse', 'HEAD'), head);
  assert.equal(await f.git('rev-parse', 'refs/tags/v1.2.3'), tag);
  assert.equal(await f.git('--git-dir', f.remote, 'rev-parse', 'main'), head);
  assert.equal(await f.git('--git-dir', f.remote, 'rev-parse', 'refs/tags/v1.2.3'), tag);
  assert.equal(await readFile(f.executorPath, 'utf8'), f.executor);
});

test('an invalid Executor increment fails before either manifest, commit or remote tag changes', async (t) => {
  const f = await fixture(t);
  const head = await f.git('rev-parse', 'HEAD');
  const before = await readFile(f.publicationPath, 'utf8');
  await assert.rejects(f.bump('patch', 'keep'), /invalid|choices/i);
  assert.equal(await readFile(f.publicationPath, 'utf8'), before);
  assert.equal(await readFile(f.executorPath, 'utf8'), f.executor);
  assert.equal(await f.git('status', '--porcelain'), '');
  assert.equal(await f.git('rev-parse', 'HEAD'), head);
  assert.equal(await f.git('--git-dir', f.remote, 'tag', '--list'), '');
});

test('CI environment credentials work without .env.publish and reach only an owned offline npm stub', async (t) => {
  const f = await fixture(t);
  for (const file of [
    'publish-release',
    'github-release',
    'github-publication-state',
    'npm-publication-state',
    'publication-choice',
    'publication-options',
    'npm-command',
    'resume-release-tag',
  ]) {
    await writeFile(
      join(f.worktree, `scripts/${file}.mjs`),
      await readFile(join(repository, `scripts/${file}.mjs`))
    );
  }
  await symlink(
    join(repository, 'apps/cli/src'),
    join(f.worktree, 'apps/cli/src'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  const bin = join(dirname(f.worktree), 'offline-npm');
  await mkdir(join(bin, 'node_modules/npm/bin'), { recursive: true });
  const deny = 'console.error("owned offline npm authentication fixture"); process.exit(1);\n';
  await writeFile(join(bin, 'node_modules/npm/bin/npm-cli.js'), deny);
  await writeFile(join(bin, 'npm.cmd'), '@echo off\r\n');
  await writeFile(join(bin, 'npm'), '#!/usr/bin/env node\n' + deny, { mode: 0o755 });
  const env = { ...f.env, GITHUB_TOKEN: 'fixture-token', CI: 'true' };
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  env[pathKey] = bin + delimiter + (env[pathKey] ?? '');
  const before = await readFile(f.publicationPath, 'utf8');
  const head = await f.git('rev-parse', 'HEAD');
  const args = [
    '--import',
    'tsx',
    join(f.worktree, 'scripts/publish-release.mjs'),
    '--bump',
    '--increment',
    'patch',
    '--executor-increment',
    'minor',
    '--ci',
  ];
  await assert.rejects(
    run(process.execPath, args, f.worktree, env),
    (error) => /Not authenticated/.test(error.stderr) && !/Missing .env.publish/.test(error.stderr)
  );
  await assert.rejects(
    run(process.execPath, args, f.worktree, { ...env, GITHUB_TOKEN: '' }),
    /GITHUB_TOKEN is required/
  );
  assert.equal(await readFile(f.publicationPath, 'utf8'), before);
  assert.equal(await readFile(f.executorPath, 'utf8'), f.executor);
  assert.equal(await f.git('rev-parse', 'HEAD'), head);
  assert.equal(await f.git('--git-dir', f.remote, 'tag', '--list'), '');
});
