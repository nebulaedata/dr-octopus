/**
 * @author Codex
 * @description Guards release publication fields, unchanged dependency metadata and discovered runtime resources.
 */
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { copyWorkspaceRelease, isInside } from '../scripts/workspace-release.mjs';

/**
 * Writes deterministic fixture files without invoking package installation or modifying the repository.
 */
async function fixtureFile(root, path, content) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}

test('Release copies original metadata and new packages without maintaining another dependency graph', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'octopus workspace release '));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const root = join(temp, 'source');
  const target = join(temp, 'release');
  await mkdir(target);
  const files = {
    'package.json': '{"name":"fixture","private":true,"packageManager":"pnpm@11.18.0"}\r\n',
    'pnpm-workspace.yaml':
      'packages: ["apps/*", "packages/*"]\nallowBuilds:\n  native-example: true\npatchedDependencies:\n  example@9.1.0: fixes/nested/new-version.patch\n',
    'pnpm-lock.yaml': 'lockfileVersion: "9.0"\nimporters:\n  apps/host:\n    dependencies: {}\n',
    'apps/host/package.json': '{"name":"host","dependencies":{"extra":"workspace:*"}}',
    'apps/host/dist/index.js': 'import "extra";',
    'packages/extra/package.json': '{"name":"extra","version":"8.2.0","exports":"./dist/index.js"}',
    'packages/extra/dist/index.js': 'export const value = 1;',
    'packages/extra/dist/assets/nested/migration.sql': 'SELECT 1;',
    'packages/types/package.json': '{"name":"types"}',
    'fixes/nested/new-version.patch': 'fixture patch\r\n',
  };
  for (const [path, content] of Object.entries(files)) {
    await fixtureFile(root, path, content);
  }
  for (const path of ['.env', 'apps/host/src/index.ts', 'apps/host/node_modules/secret/index.js']) {
    await fixtureFile(root, path, 'not a release asset');
  }
  await copyWorkspaceRelease(
    root,
    target,
    ['', 'apps/host', 'packages/extra', 'packages/types'].map((path) => ({ path: join(root, path) })),
    { '*': ['dist'] }
  );
  for (const [path, content] of Object.entries(files)) {
    assert.equal(await readFile(join(root, path), 'utf8'), content, `source ${path}`);
    assert.equal(await readFile(join(target, path), 'utf8'), content, path);
  }
  for (const path of ['.env', 'apps/host/src', 'apps/host/node_modules', 'vendor']) {
    await assert.rejects(access(join(target, path)), { code: 'ENOENT' });
  }
  await rm(join(root, 'fixes/nested/new-version.patch'));
  await assert.rejects(copyWorkspaceRelease(root, target, [], { '*': ['dist'] }), { code: 'ENOENT' });
});

test('Release rejects packages and patches outside the workspace', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'octopus release boundary '));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const root = join(temp, 'source');
  const target = join(temp, 'release');
  await mkdir(target);
  await fixtureFile(root, 'package.json', '{}');
  await fixtureFile(root, 'pnpm-lock.yaml', 'lockfileVersion: "9.0"');
  await fixtureFile(root, 'pnpm-workspace.yaml', 'patchedDependencies:\n  example: ../outside.patch');
  await assert.rejects(copyWorkspaceRelease(root, target, [{ path: temp }], {}), /outside the repository/);
  await assert.rejects(copyWorkspaceRelease(root, target, [], {}), /outside the workspace/);
  assert.equal(isInside(root, join(root, 'packages/extra')), true);
  assert.equal(isInside(root, join(temp, 'source-other')), false);
});
