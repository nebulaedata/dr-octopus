/**
 * @author Codex
 * @description Exercises real startup ordering and runtime cleanup with in-memory Server and installer doubles.
 */
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

let calls;
let install;
let listenError;
let closeError;
const config = {
  host: '127.0.0.1',
  port: 0,
  agentDir: 'unused',
  environment: 'production',
  paths: { dataDir: 'unused', logsRoot: 'unused' },
  fileLogging: { enabled: false },
};
mock.module('../../dist/lib/config/config.js', { namedExports: { loadServerConfig: () => config } });
mock.module('@octopus/agent', {
  namedExports: {
    isBundledInfraInstalled: async () => {
      calls.push('infra');
      return true;
    },
    installBundledInfra: async () => {
      throw new Error('Unexpected installation');
    },
  },
});
mock.module('../../dist/lib/startup/extension-initialization.js', {
  namedExports: {
    initializeExtensions: (...args) => install(...args),
  },
});
mock.module('../../dist/app.js', {
  namedExports: {
    createServer: () => ({
      log: { info() {}, warn() {}, error() {} },
      logging: { getHealth: () => ({ state: 'disabled' }) },
      listeningOrigin: 'http://127.0.0.1:12345',
      async listen() {
        calls.push('listen');
        if (listenError) throw listenError;
      },
      async close() {
        calls.push('close');
        if (closeError) throw closeError;
      },
    }),
  },
});
const { createServerRuntime } = await import('../../dist/runtime.js');

/**
 * Resets the deterministic collaborators for each independently owned service.
 */
function create() {
  calls = [];
  listenError = undefined;
  closeError = undefined;
  install = async () => {
    calls.push('extensions');
    return { installed: [], failures: [{ source: 'fixture', error: 'offline', networkUnavailable: true }] };
  };
  return createServerRuntime();
}

test('Starts once, exposes detached diagnostics, and closes once without signal handlers', async () => {
  const listeners = ['SIGINT', 'SIGTERM', 'message', 'disconnect'].map((name) => process.listenerCount(name));
  const runtime = create();
  assert.deepEqual(calls, []);
  await Promise.all([runtime.start(), runtime.start()]);
  assert.deepEqual(calls, ['infra', 'extensions', 'listen']);
  const status = runtime.getStatus();
  assert.equal(status.state, 'running');
  assert.equal(status.address, 'http://127.0.0.1:12345');
  assert.match(status.warnings[0], /offline/);
  status.warnings.length = 0;
  status.fileLogging.enabled = true;
  assert.equal(runtime.getStatus().warnings.length, 1);
  assert.equal(runtime.getStatus().fileLogging.enabled, false);
  await Promise.all([runtime.close(), runtime.close()]);
  assert.equal(calls.filter((call) => call === 'close').length, 1);
  assert.equal(runtime.getStatus().state, 'stopped');
  await assert.rejects(runtime.start(), /closed/);
  assert.deepEqual(
    ['SIGINT', 'SIGTERM', 'message', 'disconnect'].map((name) => process.listenerCount(name)),
    listeners
  );
});

test('Cancellation interrupts installation, prevents listen and waits for cleanup', async () => {
  const runtime = create();
  const reached = Promise.withResolvers();
  install = (_directory, signal) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener(
        'abort',
        () => {
          calls.push('abort');
          reject(signal.reason);
        },
        { once: true }
      );
      reached.resolve();
    });
  const started = runtime.start();
  const rejected = assert.rejects(started, { name: 'AbortError' });
  await reached.promise;
  await runtime.close();
  await rejected;
  assert.deepEqual(calls, ['infra', 'abort', 'close']);
  assert.equal(runtime.getStatus().state, 'stopped');
});

test('Listen failure preserves the error and cleans up exactly once', async () => {
  const runtime = create();
  listenError = Object.assign(new Error('occupied'), { code: 'EADDRINUSE' });
  await assert.rejects(runtime.start(), { code: 'EADDRINUSE' });
  assert.equal(runtime.getStatus().state, 'failed');
  await runtime.close();
  assert.equal(calls.filter((call) => call === 'close').length, 1);
});

test('Cleanup failure remains observable on subsequent close', async () => {
  const runtime = create();
  listenError = new Error('listen failed');
  closeError = new Error('close failed');
  await assert.rejects(runtime.start(), (error) => {
    assert.deepEqual(error.errors, [listenError, closeError]);
    return true;
  });
  await assert.rejects(runtime.close(), /close failed/);
  assert.equal(runtime.getStatus().state, 'failed');
});

test('Closing before start prevents initialization', async () => {
  const runtime = create();
  await runtime.close();
  await assert.rejects(runtime.start(), /closed/);
  assert.deepEqual(calls, ['close']);
});
