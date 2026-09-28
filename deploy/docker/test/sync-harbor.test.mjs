/**
 * @author Codex
 * @description Verifies digest-pinned Harbor copies, read-only previews, input boundaries and failure reporting.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runHarborCli, syncHarbor, syncOptions } from '../sync-harbor.mjs';

const digest = `sha256:${'a'.repeat(64)}`;
const source = 'docker.io/nebulaedata01/dr-octopus';
const target = 'harbor.n.nebulaedata.com/team/dr-octopus';

/**
 * Records registry commands and supplies deterministic results without accessing Docker or credentials.
 */
function commands(results) {
  const calls = [];
  const logs = [];
  return {
    calls,
    logs,
    options: {
      log: (message) => logs.push(message),
      run: (args) => {
        calls.push(args);
        assert.ok(results.length, 'Unexpected registry operation');
        const next = results.shift();
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
}

test('copies the resolved snapshot instead of re-resolving a mutable source tag', async () => {
  const state = commands([digest, '', digest]);
  const result = await syncHarbor(['--project', 'team'], state.options);
  assert.equal(result.copied, true);
  assert.deepEqual(state.calls[0], [
    'buildx',
    'imagetools',
    'inspect',
    `${source}:latest`,
    '--format',
    '{{.Manifest.Digest}}',
  ]);
  assert.deepEqual(state.calls[1], [
    'buildx',
    'imagetools',
    'create',
    '--prefer-index=false',
    '--tag',
    `${target}:latest`,
    `${source}@${digest}`,
  ]);
  assert.equal(state.calls[2][3], `${target}:latest`);
  assert.match(state.logs.at(-1), /^Verified:/);
});

test('preview resolves an exact version without contacting or writing the destination', async () => {
  const state = commands([digest]);
  const result = await syncHarbor(['--project', 'team', '--tag', '0.0.10-r1', '--dry-run'], state.options);
  assert.equal(result.copied, false);
  assert.equal(result.target, `${target}:0.0.10-r1`);
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0][3], `${source}:0.0.10-r1`);
});

test('registry failures and digest mismatches never report success', async () => {
  for (const results of [
    [new Error('source unavailable')],
    ['invalid digest'],
    [digest, new Error('unauthorized')],
    [digest, '', new Error('destination unavailable')],
    [digest, '', `sha256:${'b'.repeat(64)}`],
  ]) {
    const state = commands(results);
    await assert.rejects(() => syncHarbor(['--project', 'team'], state.options));
    assert.ok(state.logs.every((message) => !message.startsWith('Verified:')));
  }
});

test('invalid destinations and tags are rejected before any external operation', async () => {
  for (const args of [
    ['--project', ''],
    ['--project', '../team'],
    ['--project', 'team\n'],
    ['--project', 'team', '--registry', 'https://harbor.example.com/harbor/projects'],
    ['--project', 'team', '--registry', 'harbor.example.com:65536'],
    ['--project', 'team', '--tag', 'latest;echo bad'],
    ['--project', 'team', '--tag', 'latest\n'],
    ['--project', 'team', '--password', 'unsupported'],
  ]) {
    const state = commands([]);
    await assert.rejects(() => syncHarbor(args, state.options));
    assert.equal(state.calls.length, 0);
  }
  assert.equal(
    syncOptions(['--project', 'team', '--registry', 'harbor.example.com:8443']).registry,
    'harbor.example.com:8443'
  );
});

test('help works without a project, Docker or registry access', async () => {
  const state = commands([]);
  await syncHarbor(['--help'], state.options);
  assert.equal(state.calls.length, 0);
  assert.match(state.logs[0], /docker login/);
});

test('noninteractive writes require explicit --yes while help and preview remain read-only', async () => {
  const calls = [];
  const options = {
    interactive: false,
    sync: async (args) => {
      calls.push(args);
      return { copied: false };
    },
  };
  await assert.rejects(runHarborCli([], options), /requires --yes/);
  assert.equal(calls.length, 0);
  for (const flag of ['--yes', '--help', '--dry-run']) await runHarborCli([flag], options);
  assert.deepEqual(calls, [['--yes'], ['--help'], ['--dry-run']]);
});
