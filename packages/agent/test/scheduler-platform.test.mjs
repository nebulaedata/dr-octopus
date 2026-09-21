/**
 * @author Codex
 * @description Real-process scheduler singleton contention, owner death and Runtime detachment regressions.
 */
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { tryAcquireSingletonLease } from '../dist/extensions/scheduler/infrastructure/singleton-lease.js';
import { quoteWindowsArgument } from '../dist/extensions/scheduler/infrastructure/detached-launcher.js';

const fixture = new URL('./fixtures/scheduler-platform-child.mjs', import.meta.url);

/**
 * Await fixture evidence and surface startup failures instead of hanging a test.
 */
async function child(operation, path, t) {
  const process = fork(fixture, [operation, path], { stdio: ['ignore', 'pipe', 'inherit', 'ipc'] });
  process.stdout.resume();
  t.after(() => {
    if (process.exitCode === null) {
      process.kill();
    }
  });
  const [message] = await once(process, 'message', { signal: AbortSignal.timeout(10000) });
  return { process, message };
}

/**
 * Allocate only test-owned state and remove it after child cleanup.
 */
async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'octopus-scheduler-platform-'));
  t.after(async () => {
    await rm(path, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });
  return path;
}

test('OS singleton excludes concurrent processes, ignores file age and recovers after owner kill', async (t) => {
  const path = join(await directory(t), 'daemon.lock');
  const owner = await child('lock', path, t);
  assert.equal(owner.message.acquired, true);
  const competitors = await Promise.all(Array.from({ length: 6 }, () => child('lock', path, t)));
  assert.ok(competitors.every(({ message }) => message.acquired === false));
  await utimes(path, new Date(0), new Date(0));
  assert.equal(await tryAcquireSingletonLease(path), null);
  const exited = once(owner.process, 'exit');
  owner.process.kill('SIGKILL');
  await exited;
  const recovered = await tryAcquireSingletonLease(path);
  assert.ok(recovered);
  recovered.release();
  recovered.release();
  const next = await tryAcquireSingletonLease(path);
  assert.ok(next);
  next.release();
});

test('explicit lock release allows a successor while the original process remains alive', async (t) => {
  const path = join(await directory(t), 'daemon.lock');
  const first = await tryAcquireSingletonLease(path);
  assert.ok(first);
  first.release();
  const next = await child('lock', path, t);
  assert.equal(next.message.acquired, true);
  const exited = once(next.process, 'exit');
  next.process.send('release');
  await exited;
});

test('detached child survives launcher kill or Windows refuses before child execution', async (t) => {
  const path = join(await directory(t), 'survived.txt');
  const launcher = await child('launch', path, t);
  const exited = once(launcher.process, 'exit');
  launcher.process.kill('SIGKILL');
  await exited;
  await delay(1500);
  if (launcher.message.error) {
    assert.equal(process.platform, 'win32');
    assert.equal(launcher.message.error, 'SCHEDULER_DETACH_UNSUPPORTED');
    await assert.rejects(readFile(path), { code: 'ENOENT' });
    t.diagnostic('Host Job policy refused detachment: fail-closed verified; survival acceptance NOT passed.');
    assert.notEqual(
      process.env.SCHEDULER_REQUIRE_DETACH,
      '1',
      'M0 blocked: host does not allow verified detachment'
    );
  } else {
    assert.equal(await readFile(path, 'utf8'), String(launcher.message.pid));
    t.diagnostic('Independent child survived launcher SIGKILL.');
  }
});

test('Windows argv quoting preserves empty, whitespace, quotes and trailing slashes', () => {
  assert.equal(quoteWindowsArgument(''), '""');
  assert.equal(quoteWindowsArgument('a b'), '"a b"');
  assert.equal(quoteWindowsArgument('a"b'), '"a\\"b"');
  assert.equal(quoteWindowsArgument('a\\'), '"a\\\\"');
  assert.throws(() => quoteWindowsArgument('bad\0arg'));
});
