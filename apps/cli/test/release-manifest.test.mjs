/**
 * @author Codex
 * @description Verifies that publication metadata is generated only from the independent release contract.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createPublicationManifest } from '../scripts/release-manifest.mjs';
import { readReleaseConfig, createReleaseLayout } from '../src/distribution/config.ts';

const configPath = new URL('../../../release.config.json', import.meta.url);
const config = readReleaseConfig(fileURLToPath(configPath));

test('public manifest contains bootstrap and pinned pnpm, without development workspace metadata', () => {
  const manifest = createPublicationManifest(config);
  assert.equal(manifest.private, false);
  assert.equal(manifest.license, 'MIT');
  assert.deepEqual(manifest.repository, config.manifest.repository);
  assert.equal(manifest.homepage, config.manifest.homepage);
  assert.deepEqual(manifest.bugs, config.manifest.bugs);
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
      value.requiredFiles = {};
    },
    (value) => {
      value.requiredFiles = [{ package: '@octopus/agent', path: '../escape.js' }];
    },
    (value) => {
      value.requiredFiles = [{ path: 'dist/bin/octopus.js' }];
    },
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

test('publication links accept npm string and object forms and reject malformed metadata', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-metadata-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'release.config.json');
  const cases = {
    repository: {
      valid: [
        undefined,
        'github:example/project',
        { type: 'git', url: 'https://example.com/repo', directory: 'cli' },
      ],
      invalid: [
        null,
        '',
        ' ',
        1,
        [],
        {},
        { type: 'git' },
        { type: 'git', url: false },
        { type: 'git', url: 'repo', extra: 'field' },
      ],
    },
    homepage: {
      valid: [undefined, 'https://example.com'],
      invalid: [null, '', ' ', 1, [], {}],
    },
    bugs: {
      valid: [
        undefined,
        'https://example.com/issues',
        { url: 'https://example.com/issues' },
        { email: 'bugs@example.com' },
      ],
      invalid: [null, '', ' ', 1, [], {}, { url: '' }, { email: false }, { extra: 'field' }],
    },
  };
  for (const [field, { valid, invalid }] of Object.entries(cases)) {
    for (const value of [...valid, ...invalid]) {
      const candidate = structuredClone(config);
      candidate.manifest[field] = value;
      await writeFile(path, JSON.stringify(candidate));
      if (valid.includes(value)) {
        const manifest = createPublicationManifest(readReleaseConfig(path));
        assert.deepEqual(manifest[field], value);
      } else {
        assert.throws(() => readReleaseConfig(path), /Invalid release.config.json publication/);
      }
    }
  }
});
