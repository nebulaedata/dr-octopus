/**
 * @author Codex
 * @description Verifies that publication metadata is generated only from the independent release contract.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPublicationManifest } from '../scripts/release-manifest.mjs';
import { readReleaseConfig, createReleaseLayout } from '../src/distribution/config.ts';

const configPath = new URL('../../../release.config.json', import.meta.url);
const config = JSON.parse(await readFile(configPath, 'utf8'));

test('public manifest contains bootstrap and pinned pnpm, without development workspace metadata', () => {
  const manifest = createPublicationManifest(config);
  assert.equal(manifest.private, false);
  assert.equal(manifest.license, 'MIT');
  assert.equal(manifest.version, config.manifest.version);
  assert.deepEqual(manifest.dependencies, { pnpm: config.pnpmVersion });
  assert.deepEqual(manifest.bin, { [config.command]: './' + config.bootstrap.destination });
  assert.deepEqual(manifest.files, [
    config.bootstrap.destination,
    config.archive,
    'release-layout.json',
    'README.md',
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'README.zh-CN.md',
  ]);
  for (const field of ['scripts', 'devDependencies', 'workspaces', 'packageManager']) {
    assert.equal(field in manifest, false);
  }
  assert.doesNotMatch(JSON.stringify(manifest), /workspace:/);
});

test('configuration rejects traversal, malformed versions and accidental development metadata', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-config-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'release.config.json');
  for (const modify of [
    (value) => {
      delete value.manifest.license;
    },
    (value) => {
      value.manifest.license = '';
    },
    (value) => {
      value.bootstrap.destination = 'LICENSE';
    },
    (value) => {
      value.readmeTranslations = [];
    },
    (value) => {
      value.readmeTranslations = { 'README.zh-CN.md': '../outside.md' };
    },
    (value) => {
      value.readmeTranslations = { '../README.zh-CN.md': 'translation.md' };
    },
    (value) => {
      value.bootstrap.destination = 'README.zh-CN.md';
    },
    (value) => {
      delete value.readme;
    },
    (value) => {
      value.readme = '../README.md';
    },
    (value) => {
      value.bootstrap.destination = 'README.md';
    },
    (value) => {
      value.archive = '../runtime.tar.gz';
    },
    (value) => {
      value.bootstrap.path = 'C:/outside';
    },
    (value) => {
      value.pnpmVersion = 'latest';
    },
    (value) => {
      value.manifest.scripts = { postinstall: 'unexpected' };
    },
    (value) => {
      delete value.paths.gatewayEntry;
    },
    (value) => {
      value.artifacts['*'] = ['../outside'];
    },
    (value) => {
      value.bootstrap.destination = 'package.json';
    },
    (value) => {
      value.bootstrap.destination = value.archive + '/cli.mjs';
    },
    (value) => {
      value.manifest.keywords = 'invalid';
    },
  ]) {
    const value = structuredClone(config);
    modify(value);
    await writeFile(path, JSON.stringify(value));
    assert.throws(() => readReleaseConfig(path));
  }
});

test('runtime layout follows discovered package moves and rejects missing package identities', () => {
  const root = join(tmpdir(), 'fixture-repo');
  const projects = [...new Set(Object.values(config.paths).map((value) => value.package))].map(
    (name, index) => ({ name, path: join(root, 'relocated', 'component-' + index) })
  );
  const layout = createReleaseLayout(root, projects, config);
  assert.match(layout.paths.serverEntry, /^relocated\/component-\d+\/dist\/runtime.js$/);
  assert.throws(() => createReleaseLayout(root, projects.slice(1), config), /Expected one workspace package/);
});
