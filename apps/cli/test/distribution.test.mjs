/**
 * @author Codex
 * @description Exercises relocated package assembly, portable archive extraction and installer ownership without the source workspace.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { assembleRelease } from '../scripts/assemble-release.mjs';
import { prepareRuntime } from '../src/distribution/payload.ts';
import { acquireInstallLock, installLockPath } from '../src/distribution/install-lock.ts';
import { runtimeDirectory } from '../src/distribution/location.ts';

/**
 * Writes one deterministic fixture resource and creates only its parents.
 */
async function file(root, path, value) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, value);
}

/**
 * Builds a release whose packages and output directories deliberately differ from this repository.
 */
async function fixture(t) {
  const temporary = await mkdtemp(join(tmpdir(), 'octopus-distribution-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const source = join(temporary, 'source');
  const target = join(temporary, 'npm-package');
  await mkdir(target);
  const config = {
    schemaVersion: 1,
    outputDirectory: 'publication',
    readme: 'docs/npm.md',
    readmeTranslations: { 'README.zh-CN.md': 'docs/npm.zh-CN.md' },
    buildArgs: ['build'],
    manifest: {
      name: 'fixture-release',
      version: '1.2.3',
      description: 'Fixture',
      license: 'MIT',
      engines: { node: '>=22.19.0' },
    },
    pnpmVersion: '11.18.0',
    runtimeDirectory: '.dr-octopus/runtimes',
    command: 'fixture-cli',
    installFilter: 'fixture-cli...',
    bootstrap: { package: 'fixture-cli', path: 'compiled/cli.mjs', destination: 'commands/octopus.mjs' },
    archive: 'assets/application.tar.gz',
    artifacts: { '*': ['compiled'] },
    paths: {
      cli: { package: 'fixture-cli', path: '.' },
      server: { package: 'fixture-server', path: '.' },
      serverEntry: { package: 'fixture-server', path: 'compiled/runtime.js' },
      gatewayEntry: { package: 'fixture-cli', path: 'compiled/gateway.mjs' },
      webClient: { package: 'fixture-web', path: 'compiled/site' },
    },
  };
  const projects = ['cli', 'server', 'web'].map((name) => ({
    name: `fixture-${name}`,
    path: join(source, 'relocated', name),
  }));
  await file(
    source,
    'package.json',
    '{"private":true,"packageManager":"pnpm@11.18.0","scripts":{"dev":"not-published"}}'
  );
  await file(
    source,
    'pnpm-workspace.yaml',
    'packages: ["relocated/*"]\npatchedDependencies:\n  example: patches/example.patch\n'
  );
  await file(source, 'pnpm-lock.yaml', 'lockfileVersion: "9.0"\n');
  await file(source, 'patches/example.patch', 'fixture patch');
  for (const project of projects) {
    await file(project.path, 'package.json', JSON.stringify({ name: project.name, private: true }));
  }
  await file(
    source,
    'relocated/cli/compiled/cli.mjs',
    await readFile(new URL('../dist/cli.mjs', import.meta.url))
  );
  await file(source, 'relocated/cli/compiled/gateway.mjs', 'export {};');
  await file(source, 'relocated/server/compiled/runtime.js', 'export {};');
  await file(source, 'relocated/web/compiled/site/index.html', '<html>fixture</html>');
  await file(source, '.env', 'excluded');
  await file(source, config.readme, '# Published fixture\r\n[中文](./README.zh-CN.md)\r\n');
  await file(source, config.readmeTranslations['README.zh-CN.md'], '# 中文\r\n[English](./README.md)\r\n');
  await file(source, 'README.md', '# Development README');
  await file(source, 'LICENSE', 'Fixture MIT license');
  await file(source, 'THIRD_PARTY_NOTICES.md', 'Fixture third-party notices');
  const layout = await assembleRelease(source, target, projects, config);
  return { temporary, source, target, layout, config, projects };
}

test('assembly rejects missing or directory-valued compiled command entries', async (t) => {
  const { source, target, config, projects } = await fixture(t);
  config.requiredFiles = [{ package: 'fixture-cli', path: 'compiled/agent.js' }];
  const entry = join(source, 'relocated/cli/compiled/agent.js');
  await assert.rejects(assembleRelease(source, target, projects, config), /Missing required release file/);
  await mkdir(entry);
  await assert.rejects(assembleRelease(source, target, projects, config), /Missing required release file/);
  await rm(entry, { recursive: true });
  await writeFile(entry, 'export {};');
  await assembleRelease(source, target, projects, config);
});

test('publication is independent, preserves its frozen workspace and extracts away from npm', async (t) => {
  const { temporary, source, target, layout, config } = await fixture(t);
  const manifest = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
  assert.equal(
    await readFile(join(target, 'README.md'), 'utf8'),
    '# Published fixture\r\n[中文](./README.zh-CN.md)\r\n'
  );
  assert.equal(
    await readFile(join(target, 'README.zh-CN.md'), 'utf8'),
    '# 中文\r\n[English](./README.md)\r\n'
  );
  assert.ok(manifest.files.includes('README.zh-CN.md'));
  assert.equal(manifest.scripts, undefined);
  assert.equal(manifest.private, false);
  assert.deepEqual(manifest.dependencies, { pnpm: config.pnpmVersion });
  const context = { root: target, layout, packaged: true };
  assert.notEqual(runtimeDirectory(context), target);
  const runtime = join(temporary, 'user-cache', 'runtime');
  await prepareRuntime(context, runtime);
  assert.equal(manifest.license, 'MIT');
  for (const path of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    const original = await readFile(join(source, path), 'utf8');
    assert.equal(await readFile(join(target, path), 'utf8'), original);
    assert.equal(await readFile(join(runtime, path), 'utf8'), original);
  }
  await assert.rejects(readFile(join(target, 'licenses/npm-index.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(runtime, 'licenses/npm-index.json')), { code: 'ENOENT' });
  for (const path of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'patches/example.patch']) {
    assert.equal(await readFile(join(runtime, path), 'utf8'), await readFile(join(source, path), 'utf8'));
  }
  assert.equal(
    await readFile(join(runtime, layout.paths.webClient, 'index.html'), 'utf8'),
    '<html>fixture</html>'
  );
  await assert.rejects(readFile(join(runtime, '.env')), { code: 'ENOENT' });
  await file(runtime, 'node_modules/sentinel', 'keep installed dependencies');
  await prepareRuntime(context, runtime);
  assert.equal(await readFile(join(runtime, 'node_modules/sentinel'), 'utf8'), 'keep installed dependencies');
  await file(target, config.archive, 'corrupt');
  await assert.rejects(prepareRuntime(context, join(temporary, 'other-runtime')), /checksum mismatch/);
});

test('packaged CLI help and status run without pnpm; noninteractive startup gives installation instructions', async (t) => {
  const { temporary, target, config } = await fixture(t);
  const entry = join(target, config.bootstrap.destination);
  const preload = new URL('./fixtures/distribution-home.mjs', import.meta.url).href;
  const prefix = ['--experimental-test-module-mocks', '--import', preload, entry];
  const env = { ...process.env, OCTOPUS_TEST_HOME: join(temporary, 'home') };
  for (const args of [['--help'], ['--version'], ['tui', '--help'], ['gateway', 'status', '--json']]) {
    const result = spawnSync(process.execPath, [...prefix, ...args], {
      env,
      cwd: temporary,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    if (args[0] === '--version') assert.equal(result.stdout.trim(), '1.2.3');
    if (args[0] === '--help') assert.ok(result.stdout.includes(`Usage: ${config.command} `));
  }
  const missing = spawnSync(process.execPath, [...prefix, 'gateway', 'run', '--json'], {
    env,
    cwd: temporary,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(missing.status, 1);
  const response = JSON.parse(missing.stdout);
  assert.equal(response.error.code, 'DEPENDENCIES_UNAVAILABLE');
  assert.match(response.error.message, /--install-deps/);
  assert.ok(response.error.message.includes(`Run ${config.command} deps install`));
  for (const args of [
    ['--registry', 'https://registry.npmmirror.com'],
    ['tui', '--', '--yes'],
  ]) {
    const result = spawnSync(process.execPath, [...prefix, ...args], {
      env,
      cwd: temporary,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /DEPENDENCIES_UNAVAILABLE/);
    assert.doesNotMatch(result.stderr, /Install now/);
  }
  const invalid = spawnSync(process.execPath, [...prefix, '--yes', '--registry', 'file:///secret'], {
    env,
    cwd: temporary,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /INVALID_REGISTRY/);
  assert.doesNotMatch(invalid.stderr, /file:\/\/\/secret/);
  const tui = spawnSync(process.execPath, [...prefix, 'tui', '--workspace', 'general'], {
    env,
    cwd: temporary,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(tui.status, 1);
  assert.equal(tui.stdout, '');
  assert.match(tui.stderr, /DEPENDENCIES_UNAVAILABLE/);
  assert.ok(tui.stderr.includes(`Run ${config.command} deps install`));
});

test('installation ownership excludes concurrency and recovers a provably dead installer', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-install-lock-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = join(root, 'runtime');
  const unlock = await acquireInstallLock(runtime);
  await assert.rejects(acquireInstallLock(runtime), { code: 'INSTALL_IN_PROGRESS' });
  await unlock();
  const dead = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  await writeFile(
    installLockPath(runtime),
    JSON.stringify({ pid: Number(dead.stdout.trim()), token: 'dead-owner' })
  );
  await (
    await acquireInstallLock(runtime)
  )();
  await assert.rejects(readFile(installLockPath(runtime)), { code: 'ENOENT' });
});

test('first-run consent, cancellation and explicit installation use npm-owned pnpm with restricted exports', async (t) => {
  const { temporary, target, config } = await fixture(t);
  await file(
    target,
    'node_modules/pnpm/package.json',
    JSON.stringify({
      name: 'pnpm',
      version: config.pnpmVersion,
      exports: { '.': './package.json' },
      bin: { pnpm: 'bin/pnpm.cjs' },
    })
  );
  await file(
    target,
    'node_modules/pnpm/bin/pnpm.cjs',
    `
    if (process.argv.includes('--version')) console.log('${config.pnpmVersion}');
    else if (process.argv.includes('config')) console.log('https://registry.npmjs.org/');
    else { console.error('fixture installer invoked ' + JSON.stringify(process.argv.slice(2))); process.exit(19); }
  `
  );
  const entry = join(target, config.bootstrap.destination);
  const preload = new URL('./fixtures/distribution-home.mjs', import.meta.url).href;
  const env = { ...process.env, OCTOPUS_TEST_HOME: join(temporary, 'home'), OCTOPUS_TEST_TTY: '1' };
  for (const input of ['n\n', '\n', '']) {
    const result = spawnSync(
      process.execPath,
      ['--experimental-test-module-mocks', '--import', preload, entry],
      {
        cwd: temporary,
        env,
        encoding: 'utf8',
        input,
        windowsHide: true,
        timeout: 10000,
      }
    );
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /INSTALL_DECLINED|INSTALL_CANCELLED/);
    assert.doesNotMatch(result.stderr, /fixture installer invoked/);
  }
  for (const [args, input] of [
    [[], 'yes\n'],
    [['--install-deps'], ''],
    [['--yes'], ''],
    [['-y'], ''],
    [['--yes', '--registry', 'https://registry.npmmirror.com'], ''],
    [['deps', 'install', '--yes', '--registry', 'https://registry.npmmirror.com', '--json'], ''],
    [['--registry', 'https://registry.npmmirror.com', 'deps', 'install', '--json'], ''],
    [['gateway', 'run', '--yes', '--registry', 'https://registry.npmmirror.com', '--json'], ''],
    [['--yes', '--registry', 'https://registry.npmmirror.com', 'gateway', 'start', '--json'], ''],
    [['scheduler', 'start', '--yes', '--registry', 'https://registry.npmmirror.com', '--json'], ''],
    [['tui', '--yes', '--registry', 'https://registry.npmmirror.com', '--workspace', 'general'], ''],
    [['deps', 'install', '--json'], ''],
    [['gateway', 'run', '--install-deps', '--json'], ''],
    [['--install-deps', 'gateway', 'start', '--json'], ''],
    [['scheduler', 'start', '--install-deps', '--json'], ''],
    [['tui', '--install-deps', '--workspace', 'general'], ''],
    [['--install-deps', 'tui', '--model', 'fixture-model'], ''],
  ]) {
    const result = spawnSync(
      process.execPath,
      ['--experimental-test-module-mocks', '--import', preload, entry, ...args],
      {
        cwd: temporary,
        env: { ...env, OCTOPUS_TEST_TTY: args.length ? '0' : '1' },
        encoding: 'utf8',
        input,
        windowsHide: true,
        timeout: 10000,
      }
    );
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout + result.stderr, /fixture installer invoked/);
    if (args.includes('--registry')) {
      const line = result.stderr
        .split(/\r?\n/)
        .find((value) => value.startsWith('fixture installer invoked '));
      const invocation = JSON.parse(line.slice('fixture installer invoked '.length));
      assert.deepEqual(invocation.slice(-2), ['--registry', 'https://registry.npmmirror.com/']);
      assert.ok(invocation.includes('--frozen-lockfile'));
      assert.ok(invocation.includes('--prod'));
    }
    if (args.length) assert.doesNotMatch(result.stderr, /Install now/);
  }
});
