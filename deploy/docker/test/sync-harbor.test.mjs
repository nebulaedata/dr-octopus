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
  const pauses = [];
  return {
    calls,
    logs,
    pauses,
    options: {
      log: (message) => logs.push(message),
      pause: async (delay) => pauses.push(delay),
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

/**
 * Models execFile's separate stderr, including the Docker Hub token failure seen during a real copy.
 */
function tokenEof() {
  return Object.assign(new Error('Command failed: docker buildx imagetools create'), {
    stderr:
      'ERROR: failed to authorize: failed to fetch oauth token: Post "https://auth.docker.io/token": EOF',
  });
}

test('token EOF retries the confirmed snapshot only after checking the destination', async () => {
  const missing = new Error(`ERROR: ${target}:latest: not found`);
  const state = commands([digest, tokenEof(), missing, '', digest]);
  let confirmations = 0;
  const result = await syncHarbor(['--project', 'team'], {
    ...state.options,
    confirm: async () => {
      confirmations++;
      return true;
    },
  });
  assert.equal(result.copied, true);
  assert.equal(confirmations, 1);
  assert.deepEqual(state.pauses, [2000]);
  assert.deepEqual(
    state.calls.map((command) => command[2]),
    ['inspect', 'create', 'inspect', 'create', 'inspect']
  );
  assert.deepEqual(state.calls[1], state.calls[3]);
  assert.equal(state.calls[3].at(-1), `${source}@${digest}`);
});

test('an already completed copy is verified after EOF without pushing it again', async () => {
  const state = commands([digest, tokenEof(), digest, digest]);
  assert.equal((await syncHarbor(['--project', 'team'], state.options)).copied, true);
  assert.equal(state.calls.filter((command) => command[2] === 'create').length, 1);
  assert.deepEqual(state.pauses, []);
});

test('unknown destination state stops automatic re-push after an interrupted copy', async () => {
  const state = commands([digest, tokenEof(), new Error('403 Forbidden')]);
  await assert.rejects(syncHarbor(['--project', 'team'], state.options), /no automatic re-push/);
  assert.equal(state.calls.filter((command) => command[2] === 'create').length, 1);
  assert.deepEqual(state.pauses, []);
  assert.ok(state.logs.every((message) => !message.startsWith('Verified:')));
});

test('repeated token EOF is bounded to three copy attempts', async () => {
  const missing = new Error(`ERROR: ${target}:latest: not found`);
  const state = commands([digest, tokenEof(), missing, tokenEof(), missing, tokenEof(), missing]);
  await assert.rejects(syncHarbor(['--project', 'team'], state.options), /after 3 attempts/);
  assert.equal(state.calls.filter((command) => command[2] === 'create').length, 3);
  assert.deepEqual(state.pauses, [2000, 5000]);
  assert.ok(state.logs.every((message) => !message.startsWith('Verified:')));
});

test('source and verification network retries do not repeat a successful copy', async () => {
  const state = commands([
    new Error('TLS handshake timeout'),
    digest,
    '',
    new Error('connection reset'),
    digest,
  ]);
  assert.equal((await syncHarbor(['--project', 'team'], state.options)).copied, true);
  assert.equal(state.calls.filter((command) => command[2] === 'create').length, 1);
  assert.deepEqual(state.pauses, [2000, 2000]);
});

test('credentials, TLS trust failures and killed commands are never retried', async () => {
  for (const failure of [
    new Error('failed to authorize: 401 Unauthorized'),
    new Error('403 Forbidden'),
    new Error('x509: certificate signed by unknown authority'),
    Object.assign(new Error('EOF'), { killed: true, signal: 'SIGTERM' }),
  ]) {
    const state = commands([digest, failure]);
    await assert.rejects(syncHarbor(['--project', 'team'], state.options));
    assert.equal(state.calls.length, 2);
    assert.deepEqual(state.pauses, []);
  }
});

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
