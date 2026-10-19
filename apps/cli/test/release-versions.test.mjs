/**
 * @author Codex
 * @description Verifies independent SemVer planning and in-place Executor version writes without publishing or changing repository versions.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  bumpExecutorVersion,
  incrementExecutorVersion,
  planReleaseVersions,
} from '../../../scripts/release-versions.mjs';
import { executorReleaseDefines } from '../../web/scripts/executor-release-config.ts';

/**
 * Creates only the two authoritative version inputs inside an owned temporary directory.
 */
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'octopus-version-plan-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'apps/executor'), { recursive: true });
  const repository = '{"manifest":{"version":"0.0.14"}}\r\n';
  const executor =
    '{\r\n  "name": "@octopus/executor",\r\n  "version": "0.0.1",\r\n  "private": true\r\n}\r\n';
  await writeFile(join(root, 'release.config.json'), repository);
  await writeFile(join(root, 'apps/executor/package.json'), executor);
  return { root, repository, executor };
}

test('planning keeps product versions independent and never writes either manifest', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await planReleaseVersions(f.root, { increment: 'patch', executorIncrement: 'minor' }), {
    repository: { current: '0.0.14', next: '0.0.15' },
    executor: { current: '0.0.1', next: '0.1.0' },
  });
  assert.equal(await readFile(join(f.root, 'release.config.json'), 'utf8'), f.repository);
  assert.equal(await readFile(join(f.root, 'apps/executor/package.json'), 'utf8'), f.executor);
  const next = await planReleaseVersions(f.root, { increment: 'patch', executorIncrement: 'patch' });
  const defines = executorReleaseDefines(next.repository.next, next.executor.next, {});
  assert.equal(JSON.parse(defines['import.meta.env.VITE_EXECUTOR_VERSION']), '0.0.2');
  assert.match(
    JSON.parse(defines['import.meta.env.VITE_EXECUTOR_WINDOWS_INSTALLER_URL']),
    /\/v0\.0\.15\/Dr\.Octopus-Executor-0\.0\.2-win-x64-setup-unsigned\.exe$/
  );
  assert.match(
    JSON.parse(defines['import.meta.env.VITE_EXECUTOR_WINDOWS_ZIP_URL']),
    /\/v0\.0\.15\/Dr\.Octopus-Executor-0\.0\.2-win-x64-unpacked-unsigned\.zip$/
  );
  for (const increment of ['0.0.14', '0.0.13', 'invalid', undefined]) {
    await assert.rejects(planReleaseVersions(f.root, { increment, executorIncrement: 'patch' }));
  }
});

test('Executor bump changes only its authoritative version and preserves CRLF and unrelated fields', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await bumpExecutorVersion(f.root, 'patch'), { current: '0.0.1', next: '0.0.2' });
  assert.equal(
    await readFile(join(f.root, 'apps/executor/package.json'), 'utf8'),
    f.executor.replace('0.0.1', '0.0.2')
  );
  assert.equal(await readFile(join(f.root, 'release.config.json'), 'utf8'), f.repository);
  for (const increment of ['keep', 'invalid', undefined]) {
    await assert.rejects(bumpExecutorVersion(f.root, increment));
  }
  await assert.rejects(
    bumpExecutorVersion(f.root, 'minor', { expectedVersion: '0.0.1' }),
    /changed after release planning/
  );
  assert.equal(
    await readFile(join(f.root, 'apps/executor/package.json'), 'utf8'),
    f.executor.replace('0.0.1', '0.0.2')
  );
});

test('explicit increments follow SemVer including pre-1.0 and prerelease promotion', () => {
  assert.equal(incrementExecutorVersion('0.0.1', 'major'), '1.0.0');
  assert.equal(incrementExecutorVersion('0.0.1', 'minor'), '0.1.0');
  assert.equal(incrementExecutorVersion('1.2.3-rc.1', 'patch'), '1.2.3');
  for (const value of ['v1.2.3', '1.2', '01.2.3', '1.2.3\n'])
    assert.throws(() => incrementExecutorVersion(value, 'patch'), /Invalid Executor/);
});
