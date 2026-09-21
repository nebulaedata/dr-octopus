/**
 * @author Codex
 * @description Verifies OS locking, authenticated ownership, stale identity behavior and bounded Gateway control.
 */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { acquireGateway } from '../src/gateway/owner.ts';
import { getGatewayStatus, readGatewayIdentity, requestGateway } from '../src/gateway/client.ts';
import { gatewayPaths } from '../src/gateway/protocol.ts';

test('Gateway lifecycle holds an exclusive OS lock and requires the full identity', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-gateway-test-'));
  const paths = {
    directory,
    record: join(directory, 'instance.json'),
    endpoint:
      process.platform === 'win32'
        ? `\\\\.\\pipe\\octopus-test-${randomUUID()}`
        : join(directory, 'control.sock'),
  };
  let stopped = false;
  const owner = await acquireGateway(
    '/test/server/index.js',
    'test',
    () => {
      stopped = true;
    },
    paths
  );
  t.after(async () => {
    await owner.close();
    await rm(directory, { recursive: true, force: true });
  });
  const identity = await readGatewayIdentity(paths);
  const status = await getGatewayStatus(paths);
  assert.equal(status.pid, process.pid);
  assert.equal(status.state, 'starting');
  assert.equal('token' in status, false);
  await assert.rejects(
    acquireGateway('/different/release.js', 'test', () => {}, paths),
    { code: 'GATEWAY_ALREADY_RUNNING' }
  );
  await assert.rejects(requestGateway({ ...identity, token: 'wrong' }, 'stop', paths));
  assert.equal(stopped, false);
  await requestGateway(identity, 'stop', paths);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopped, true);
  assert.equal((await getGatewayStatus(paths)).state, 'stopping');
});

test('Malformed Gateway state fails closed and fixed paths ignore Server data overrides', async (t) => {
  const before = gatewayPaths();
  const original = process.env.SERVER_DATA_DIR;
  process.env.SERVER_DATA_DIR = join(tmpdir(), 'other-data');
  assert.deepEqual(gatewayPaths(), before);
  if (original === undefined) {
    delete process.env.SERVER_DATA_DIR;
  } else {
    process.env.SERVER_DATA_DIR = original;
  }
  const directory = await mkdtemp(join(tmpdir(), 'octopus-gateway-invalid-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const paths = {
    directory,
    record: join(directory, 'instance.json'),
    endpoint: join(directory, 'control.sock'),
  };
  await writeFile(paths.record, '{broken');
  await assert.rejects(getGatewayStatus(paths), { code: 'GATEWAY_IDENTITY_UNVERIFIED' });
});

test(
  'Concurrent processes have one winner and a crash releases its OS lock',
  { timeout: 15000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'octopus-gateway-race-'));
    const paths = {
      directory,
      record: join(directory, 'instance.json'),
      endpoint:
        process.platform === 'win32'
          ? `\\\\.\\pipe\\octopus-race-${randomUUID()}`
          : join(directory, 'control.sock'),
    };
    const children = Array.from({ length: 3 }, () =>
      fork(new URL('./fixtures/gateway-owner.mjs', import.meta.url), [JSON.stringify(paths)], {
        execArgv: ['--import', 'tsx'],
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      })
    );
    let replacement;
    t.after(async () => {
      await replacement?.close();
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) {
          const exited = once(child, 'exit');
          child.kill('SIGKILL');
          await exited;
        }
      }
      await rm(directory, { recursive: true, force: true });
    });
    const results = await Promise.all(children.map(async (child) => (await once(child, 'message'))[0]));
    assert.equal(results.filter((result) => result.acquired).length, 1);
    assert.ok(
      results
        .filter((result) => !result.acquired)
        .every((result) => result.code === 'GATEWAY_ALREADY_RUNNING')
    );
    const winner = children[results.findIndex((result) => result.acquired)];
    const exited = once(winner, 'exit');
    winner.kill('SIGKILL');
    await exited;
    assert.equal(await getGatewayStatus(paths), null);
    replacement = await acquireGateway('/replacement/index.js', 'test', () => {}, paths);
    assert.equal((await getGatewayStatus(paths)).pid, process.pid);
  }
);
