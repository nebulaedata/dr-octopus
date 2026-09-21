/**
 * @author Codex
 * @description Exercises environment precedence, safe persistence, failures, and competing writers in isolated files.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createEnvironmentStore, loadEnvironment } from '../dist/index.js';

test('lock checks preserve domain errors and unchanged updates preserve exact file bytes', async (t) => {
  const { path } = await fixture(t);
  const original = '{ "VALUE": "one" }';
  await writeFile(path, original);
  const store = createEnvironmentStore({ path, environment: {} });
  const before = store.load();
  const sentinel = new Error('confirmation required');
  await assert.rejects(
    store.update(
      before.revision,
      { VALUE: 'two' },
      {
        check(current, next) {
          assert.equal(current.VALUE, 'one');
          assert.equal(next.VALUE, 'two');
          throw sentinel;
        },
      }
    ),
    (error) => error === sentinel
  );
  const unchanged = await store.update(before.revision, { VALUE: 'one' });
  assert.equal(unchanged.revision, before.revision);
  assert.equal(await readFile(path, 'utf8'), original);
  assert.equal((await store.update(before.revision, { VALUE: 'two' })).persisted.VALUE, 'two');
});

/**
 * Allocates isolated configuration files and removes only this test's temporary directory.
 */
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'octopus-env-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, path: join(root, 'environment.json') };
}

test('precedence, empty strings and sources remain separate from process.env', async (t) => {
  const { root, path } = await fixture(t);
  const dotenvPath = join(root, '.env');
  await writeFile(path, JSON.stringify({ KEY: 'file', FILE: 'file', EMPTY: 'file' }));
  await writeFile(dotenvPath, 'KEY=dotenv\nDOTENV=development\nEMPTY=\n');
  const env = { KEY: 'process' };
  const options = { path, dotenvPath, environment: env, defaults: { DEFAULT: 'default' } };
  const snapshot = loadEnvironment(options);
  assert.deepEqual(snapshot.values, {
    KEY: 'process',
    FILE: 'file',
    EMPTY: '',
    DOTENV: 'development',
    DEFAULT: 'default',
  });
  assert.deepEqual(snapshot.sources, {
    KEY: 'process',
    FILE: 'file',
    EMPTY: 'dotenv',
    DOTENV: 'dotenv',
    DEFAULT: 'default',
  });
  assert.equal(loadEnvironment({ ...options, overrides: { KEY: 'cli' } }).values.KEY, 'cli');
  assert.deepEqual(env, { KEY: 'process' });
  assert.equal(snapshot.persisted.KEY, 'file');
  assert.ok(Object.isFrozen(snapshot.values));
  assert.throws(() => loadEnvironment({ path: 'relative.json' }), { code: 'ENV_INVALID' });
});

test('patches preserve independent keys, detect stale revisions and delete only stored values', async (t) => {
  const { root, path } = await fixture(t);
  const store = createEnvironmentStore({
    path,
    environment: { KEY: 'override' },
    defaults: { BASE: 'default' },
  });
  const missing = store.load();
  assert.deepEqual(await readdir(root), []);
  const first = await store.update(missing.revision, { KEY: 'private-value', KEEP: 'retained' });
  assert.equal(first.values.KEY, 'override');
  assert.equal(store.get('KEY'), 'override');
  assert.equal(store.source('KEY'), 'process');
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { KEY: 'private-value', KEEP: 'retained' });
  await assert.rejects(store.update(missing.revision, { KEY: 'stale' }), { code: 'ENV_CONFLICT' });
  const last = await store.update(first.revision, { KEY: null });
  assert.deepEqual(last.persisted, { KEEP: 'retained' });
  assert.equal(last.values.KEY, 'override');
  assert.deepEqual(await readdir(root), ['environment.json']);
});

test('competing stores cannot both commit the same revision', async (t) => {
  const { path } = await fixture(t);
  const options = { path, environment: {} };
  const first = createEnvironmentStore(options);
  const second = createEnvironmentStore(options);
  const revision = first.load().revision;
  const results = await Promise.allSettled([
    first.update(revision, { FIRST: '1' }),
    second.update(revision, { SECOND: '2' }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const failure = results.find((result) => result.status === 'rejected');
  assert.ok(['ENV_BUSY', 'ENV_CONFLICT'].includes(failure.reason.code));
  assert.equal(Object.keys(first.load().persisted).length, 1);
});

test('oversized writes cannot commit a document that the next read would reject', async (t) => {
  const { path } = await fixture(t);
  const store = createEnvironmentStore({ path, environment: {} });
  const before = store.load();
  const changes = Object.fromEntries(
    Array.from({ length: 150 }, (_, index) => [`KEY_${index}`, 'x'.repeat(8192)])
  );
  await assert.rejects(store.update(before.revision, changes), { code: 'ENV_INVALID' });
  assert.equal(store.load().revision, before.revision);
  assert.equal(store.get('constructor'), undefined);
});

test(
  'Windows process casing does not bypass a persisted variable override',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const { path } = await fixture(t);
    await writeFile(path, '{"CUSTOM_PATH":"file"}');
    const store = createEnvironmentStore({ path, environment: { Custom_Path: 'process' } });
    assert.equal(store.get('CUSTOM_PATH'), 'process');
    assert.equal(store.get('custom_path'), 'process');
    assert.equal(store.source('CUSTOM_PATH'), 'process');
  }
);

test('invalid documents fail without disclosing contents and failed writes preserve the previous document', async (t) => {
  const { path } = await fixture(t);
  for (const content of [
    '{"SECRET":"do-not-log",',
    '{"PORT":3000}',
    '[]',
    '{"__proto__":"bad"}',
    '{"foo":"1","FOO":"2"}',
  ]) {
    await writeFile(path, content);
    assert.throws(
      () => loadEnvironment({ path, environment: {} }),
      (error) => {
        assert.equal(error.code, 'ENV_INVALID');
        assert.doesNotMatch(error.message, /do-not-log/);
        return true;
      }
    );
  }
  await writeFile(path, '{"KEEP":"original"}');
  const store = createEnvironmentStore({ path, environment: {} });
  await assert.rejects(store.update(store.load().revision, { BAD: 'a\0b' }), { code: 'ENV_INVALID' });
  assert.equal(await readFile(path, 'utf8'), '{"KEEP":"original"}');
  await writeFile(path + '.lock', '');
  await assert.rejects(store.update(store.load().revision, { KEEP: 'lost' }), { code: 'ENV_BUSY' });
  assert.equal(await readFile(path, 'utf8'), '{"KEEP":"original"}');
});
