/**
 * @author Codex
 * @description Verifies optional file logging, bounded retention, safe fallback, and shutdown flushing.
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { pruneServerLogFiles } from '../dist/infrastructure/logging/log-retention.js';
import { closeFileLogging } from '../dist/infrastructure/logging/file-log-lifecycle.js';
import { acquireFileLogLease } from '../dist/infrastructure/logging/file-log-lease.js';
import {
  createServerLoggerRuntime,
  ServerFileLoggingInitializationError,
} from '../dist/infrastructure/logging/server-logger-runtime.js';

const temporaryRoots = [];

test.after(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
});

test('disabled file logging does not create the logs directory', async () => {
  const root = await createTemporaryRoot();
  const logsRoot = join(root, 'logs');
  const runtime = createServerLoggerRuntime({
    level: 'silent',
    pretty: false,
    logsRoot,
    fileLogging: createFileLoggingConfig({ enabled: false }),
  });

  assert.deepEqual(runtime.getHealth(), { state: 'disabled', required: false });
  await runtime.close();
  assert.equal(existsSync(logsRoot), false);
});

test('enabled file logging writes parseable redacted JSONL and flushes on close', async () => {
  const root = await createTemporaryRoot();
  const logsRoot = join(root, 'logs');
  const runtime = createServerLoggerRuntime({
    level: 'silent',
    pretty: false,
    logsRoot,
    fileLogging: createFileLoggingConfig({ enabled: true, level: 'info' }),
  });

  runtime.logger.info(
    {
      event: 'test.file-log.write',
      prompt: 'must-not-leak',
      attachment: { base64: 'must-not-leak' },
      payload: { prompt: 'nested-must-not-leak' },
      err: new Error('credential must-not-leak'),
      code: 'SAFE_TEST_CODE',
    },
    'File logger test'
  );
  await runtime.ready();
  await runtime.close();

  const names = (await readdir(logsRoot)).filter((name) => name.endsWith('.jsonl'));
  assert.equal(names.length, 1);
  const lines = (await readFile(join(logsRoot, names[0]), 'utf8')).trim().split('\n');
  const entry = JSON.parse(lines.at(-1));
  assert.equal(entry.event, 'test.file-log.write');
  assert.equal(entry.prompt, undefined);
  assert.equal(entry.attachment, undefined);
  assert.equal(entry.payload, undefined);
  assert.equal(entry.err.message, '[Redacted]');
  assert.equal(entry.err.stack, undefined);
  assert.equal(entry.code, 'SAFE_TEST_CODE');
  assert.equal(entry.service, 'octopus-server');
  assert.equal(entry.schemaVersion, 1);
  assert.equal(JSON.stringify(entry).includes('must-not-leak'), false);
  if (process.platform !== 'win32') {
    assert.equal((await stat(join(logsRoot, names[0]))).mode & 0o777, 0o600);
    assert.equal((await stat(logsRoot)).mode & 0o777, 0o700);
  }
});

test('optional file logging degrades to stdout when its directory cannot be created', async () => {
  const root = await createTemporaryRoot();
  const blockingFile = join(root, 'blocking-file');
  await writeFile(blockingFile, 'not a directory');

  const runtime = createServerLoggerRuntime({
    level: 'silent',
    pretty: false,
    logsRoot: join(blockingFile, 'logs'),
    fileLogging: createFileLoggingConfig({ enabled: true }),
  });

  assert.deepEqual(runtime.getHealth(), {
    state: 'degraded',
    required: false,
    errorCode: 'SERVER_FILE_LOG_INIT_FAILED',
  });
  await runtime.close();
});

test('required file logging rejects startup when its directory cannot be created', async () => {
  const root = await createTemporaryRoot();
  const blockingFile = join(root, 'blocking-file');
  await writeFile(blockingFile, 'not a directory');

  assert.throws(
    () =>
      createServerLoggerRuntime({
        level: 'silent',
        pretty: false,
        logsRoot: join(blockingFile, 'logs'),
        fileLogging: createFileLoggingConfig({ enabled: true, required: true }),
      }),
    ServerFileLoggingInitializationError
  );
});

test('one logs directory permits only one active file transport runtime', async () => {
  const root = await createTemporaryRoot();
  const logsRoot = join(root, 'logs');
  const first = createServerLoggerRuntime({
    level: 'silent',
    pretty: false,
    logsRoot,
    fileLogging: createFileLoggingConfig({ enabled: true, required: true }),
  });
  assert.equal(
    (await readdir(logsRoot)).some((name) => name.includes('.candidate-')),
    false
  );

  assert.throws(
    () =>
      createServerLoggerRuntime({
        level: 'silent',
        pretty: false,
        logsRoot,
        fileLogging: createFileLoggingConfig({ enabled: true, required: true }),
      }),
    ServerFileLoggingInitializationError
  );
  await first.close();

  const replacement = createServerLoggerRuntime({
    level: 'silent',
    pretty: false,
    logsRoot,
    fileLogging: createFileLoggingConfig({ enabled: true, required: true }),
  });
  await replacement.close();
});

test('stale lease recovery does not remove a lock while another recovery owns its token', async () => {
  const root = await createTemporaryRoot();
  const logsRoot = join(root, 'logs');
  await mkdir(logsRoot);
  const stalePid = createExitedProcessId();
  const lockPath = join(logsRoot, '.server-log-writer.lock');
  const staleToken = 'de305d54-75b4-431b-adb2-eb6b9e546014';
  await writeFile(lockPath, JSON.stringify({ pid: stalePid, token: staleToken }));
  await writeFile(
    `${lockPath}.recovery-${staleToken}`,
    JSON.stringify({ pid: process.pid, token: '8e25308d-13bd-4909-886c-fbd52b12d777' })
  );

  assert.throws(() => acquireFileLogLease(logsRoot), /already owned/);
  assert.deepEqual(JSON.parse(await readFile(lockPath, 'utf8')), { pid: stalePid, token: staleToken });
});

test('startup retention runs after the worker publishes its active file', async () => {
  const root = await createTemporaryRoot();
  const logsRoot = join(root, 'logs');
  await mkdir(logsRoot);
  const expired = join(logsRoot, 'server.2020-01-01.1.jsonl');
  await writeFile(expired, 'expired');
  await utimes(expired, new Date(0), new Date(0));
  const runtime = createServerLoggerRuntime({
    level: 'silent',
    pretty: false,
    logsRoot,
    fileLogging: createFileLoggingConfig({ enabled: true, retentionDays: 1 }),
  });

  await runtime.ready();

  assert.equal(existsSync(expired), false);
  await runtime.close();
});

test('retention removes expired managed files but preserves the explicit active and unrelated entries', async () => {
  const root = await createTemporaryRoot();
  const logsRoot = join(root, 'logs');
  await mkdir(logsRoot);
  const old = join(logsRoot, 'server.2026-01-01.1.jsonl');
  const middle = join(logsRoot, 'server.2026-01-02.1.jsonl');
  const active = join(logsRoot, 'server.2026-01-03.1.jsonl');
  const future = join(logsRoot, 'server.2099-01-01.1.jsonl');
  const unrelated = join(logsRoot, 'permission-audit.jsonl');
  await Promise.all([
    writeFile(old, 'old'),
    writeFile(middle, 'middle'),
    writeFile(active, 'active'),
    writeFile(future, 'future'),
    writeFile(unrelated, 'unrelated'),
  ]);
  const now = Date.UTC(2026, 0, 10);
  await utimes(old, new Date(now - 10 * 86_400_000), new Date(now - 10 * 86_400_000));
  await utimes(middle, new Date(now - 2 * 86_400_000), new Date(now - 2 * 86_400_000));
  await utimes(active, new Date(now - 1 * 86_400_000), new Date(now - 1 * 86_400_000));
  await utimes(future, new Date(now + 100 * 86_400_000), new Date(now + 100 * 86_400_000));

  await pruneServerLogFiles(logsRoot, { retentionDays: 5, maxFiles: 2, maxTotalSizeMb: 1 }, now, active);

  assert.equal(existsSync(old), false);
  assert.equal(existsSync(middle), false);
  assert.equal(existsSync(active), true);
  assert.equal(existsSync(future), true);
  assert.equal(existsSync(unrelated), true);
});

test('retention does nothing when the worker has not published a valid active file', async () => {
  const root = await createTemporaryRoot();
  const logsRoot = join(root, 'logs');
  await mkdir(logsRoot);
  const first = join(logsRoot, 'server.2026-01-01.1.jsonl');
  const second = join(logsRoot, 'server.2026-01-02.1.jsonl');
  await Promise.all([writeFile(first, 'first'), writeFile(second, 'second')]);

  await pruneServerLogFiles(logsRoot, { retentionDays: 1, maxFiles: 2, maxTotalSizeMb: 1 });

  assert.equal(existsSync(first), true);
  assert.equal(existsSync(second), true);
});

test('retention enforces total size without deleting the explicit active file', async () => {
  const root = await createTemporaryRoot();
  const logsRoot = join(root, 'logs');
  await mkdir(logsRoot);
  const old = join(logsRoot, 'server.2026-01-01.1.jsonl');
  const active = join(logsRoot, 'server.2026-01-02.1.jsonl');
  const payload = Buffer.alloc(600 * 1024, 'x');
  await Promise.all([writeFile(old, payload), writeFile(active, payload)]);

  await pruneServerLogFiles(
    logsRoot,
    { retentionDays: 365, maxFiles: 10, maxTotalSizeMb: 1 },
    Date.now(),
    active
  );

  assert.equal(existsSync(old), false);
  assert.equal(existsSync(active), true);
});

test('close failure retains the writer lease until process ownership ends', async () => {
  const transport = new EventEmitter();
  transport.flush = () => {};
  transport.end = () => {};
  transport.write = () => true;
  let leaseReleased = false;
  let closeFailed = false;

  await closeFileLogging({
    transport,
    lease: { close: () => (leaseReleased = true) },
    onError: () => (closeFailed = true),
    closeTimeoutMs: 10,
  });

  assert.equal(closeFailed, true);
  assert.equal(leaseReleased, false);
});

/**
 * Creates one tracked temporary root for cross-platform cleanup.
 */
async function createTemporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), 'octopus-file-logging-'));
  temporaryRoots.push(root);
  return root;
}

/**
 * Returns the process identity of a child that has already exited for stale-lock recovery tests.
 */
function createExitedProcessId() {
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], {
    encoding: 'utf8',
  });
  assert.equal(child.status, 0);
  return Number(child.stdout);
}

/**
 * Produces a complete validated-equivalent file logging policy for focused unit tests.
 *
 * @param {Partial<import('../dist/infrastructure/config/utils.js').ServerFileLoggingConfig>} [overrides]
 */
function createFileLoggingConfig(overrides = {}) {
  return {
    enabled: false,
    level: 'info',
    maxSizeMb: 50,
    retentionDays: 14,
    maxFiles: 30,
    maxTotalSizeMb: 1024,
    required: false,
    ...overrides,
  };
}
