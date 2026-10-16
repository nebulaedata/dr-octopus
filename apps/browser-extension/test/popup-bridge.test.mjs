/**
 * @author Codex
 * @description Verifies actual worker popup admission, handshake evidence, pause ownership and stale-connection rejection with controlled Native Messaging peers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../entrypoints/background.ts', import.meta.url))],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  define: { 'import.meta.env.BROWSER': '"chrome"' },
});

/**
 * Evaluates the production worker against browser APIs whose event order is controlled by each test.
 */
function fixture(saved = {}) {
  const listeners = [];
  const storageListeners = [];
  const alarms = new Map();
  const ports = [];
  const timers = new Set();
  const values = { ...saved };
  const browser = {
    runtime: {
      id: 'owned-extension',
      getURL: (path) => 'chrome-extension://owned-extension' + path,
      getManifest: () => ({ version: '0.1.2' }),
      onMessage: { addListener: (listener) => listeners.push(listener) },
      onStartup: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
      /**
       * Creates a connection-only peer, with no OS Host registration or page action dispatch.
       */
      connectNative() {
        const messages = [];
        const disconnected = [];
        const sent = [];
        const port = {
          sent,
          closed: false,
          onMessage: { addListener: (listener) => messages.push(listener) },
          onDisconnect: { addListener: (listener) => disconnected.push(listener) },
          postMessage: (message) => sent.push(message),
          /**
           * Delivers disconnection synchronously so stale callbacks remain observable.
           */
          disconnect() {
            port.closed = true;
            disconnected.forEach((listener) => listener());
          },
          receive: (message) => messages.forEach((listener) => listener(message)),
        };
        ports.push(port);
        return port;
      },
    },
    tabs: {
      onActivated: { addListener: () => {} },
      onRemoved: { addListener: () => {} },
      onReplaced: { addListener: () => {} },
      onUpdated: { addListener: () => {} },
    },
    storage: {
      local: {
        get: async () => ({ ...values }),
        /**
         * Notifies genuine pause transitions while retaining persisted labels across worker fixtures.
         */
        async set(next) {
          const changes = {};
          for (const [key, value] of Object.entries(next)) {
            if (values[key] !== value) {
              changes[key] = { oldValue: values[key], newValue: value };
            }
            values[key] = value;
          }
          if (Object.keys(changes).length) {
            storageListeners.forEach((listener) => listener(changes, 'local'));
          }
        },
      },
      onChanged: { addListener: (listener) => storageListeners.push(listener) },
    },
    alarms: {
      onAlarm: { addListener: () => {} },
      clear: async (name) => alarms.delete(name),
      create: async (name, alarm) => alarms.set(name, alarm),
    },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', bundle.outputFiles[0].text)(
    (name) => {
      if (name === 'wxt/browser') {
        return { browser };
      }
      if (name === 'wxt/utils/define-background') {
        return { defineBackground: (options) => options };
      }
      return require(name);
    },
    module,
    module.exports,
    (callback) => {
      timers.add(callback);
      return callback;
    },
    (callback) => timers.delete(callback)
  );
  module.exports.default.main();
  /**
   * Sends metadata only from the owned popup unless a test explicitly supplies an untrusted sender.
   */
  function request(message, sender = { id: browser.runtime.id, url: browser.runtime.getURL('/popup.html') }) {
    return listeners.map((listener) => listener(message, sender)).find((reply) => reply !== undefined);
  }
  return { ports, values, alarms, request, browser };
}

/**
 * Waits for controlled microtasks, not guessed page-action delays.
 */
async function settled(predicate) {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('Controlled worker did not settle.');
}

/**
 * Answers the actual request ID emitted by this worker's handshake.
 */
function connect(port) {
  port.receive({
    type: 'connected',
    requestId: port.sent[0].requestId,
    version: 3,
    connectionId: randomUUID(),
  });
}

test('popup status uses a live handshake, never a previous worker connected label', async () => {
  const f = fixture({ bridgeStatus: 'connected' });
  await settled(() => f.ports[0]?.sent.length);
  const before = await f.request({ type: 'bridge.status' });
  assert.equal(before.phase, 'connecting');
  assert.equal(before.toolsReady, false);
  connect(f.ports[0]);
  const connected = await f.request({ type: 'bridge.status' });
  assert.equal(connected.phase, 'connected');
  assert.equal(connected.toolsReady, true);
  assert.equal(connected.installationId, f.values.installationId);
  f.ports[0].disconnect();
  await settled(() => f.values.bridgeStatus === 'disconnected');
  assert.equal((await f.request({ type: 'bridge.status' })).toolsReady, false);
});

test('page, wrong extension and malformed popup commands cannot change connection preferences', async () => {
  const f = fixture({ paused: true });
  await settled(() => f.values.bridgeStatus === 'paused');
  for (const sender of [
    { id: 'another-extension', url: 'chrome-extension://owned-extension/popup.html' },
    { id: 'owned-extension', url: 'https://fixture.test/' },
    { id: 'owned-extension', url: 'chrome-extension://owned-extension/another.html' },
  ]) {
    assert.equal(f.request({ type: 'bridge.pause', paused: false }, sender), undefined);
  }
  assert.equal(f.request({ type: 'bridge.pause', paused: false, execute: 'click' }), undefined);
  assert.equal(f.request({ type: 'browser_click' }), undefined);
  assert.equal(f.values.paused, true);
  assert.equal(f.ports.length, 0);
});

test('pause survives worker restart; resume and retry restore only a fresh connection', async () => {
  const f = fixture();
  await settled(() => f.ports[0]?.sent.length);
  const old = f.ports[0];
  connect(old);
  assert.equal((await f.request({ type: 'bridge.pause', paused: true })).phase, 'paused');
  assert.equal(old.closed, true);
  assert.equal(f.alarms.size, 0);
  await f.request({ type: 'bridge.reconnect' });
  assert.equal(f.ports.length, 1);
  const restarted = fixture(f.values);
  await settled(() => restarted.values.bridgeStatus === 'paused');
  assert.equal((await restarted.request({ type: 'bridge.status' })).phase, 'paused');
  assert.equal(restarted.ports.length, 0);
  await f.request({ type: 'bridge.pause', paused: false });
  await settled(() => f.ports[1]?.sent.length);
  connect(old);
  assert.equal((await f.request({ type: 'bridge.status' })).toolsReady, false);
  connect(f.ports[1]);
  assert.equal((await f.request({ type: 'bridge.status' })).toolsReady, true);
  assert.deepEqual(
    f.ports[1].sent.map((message) => message.type),
    ['hello']
  );
});

test('version incompatibility and Runtime offline remain distinct from tool readiness', async () => {
  for (const code of ['VERSION_INCOMPATIBLE', 'RUNTIME_OFFLINE', 'DISABLED']) {
    const f = fixture();
    await settled(() => f.ports[0]?.sent.length);
    f.ports[0].receive({ type: 'error', requestId: null, code });
    await settled(() => f.values.bridgeStatus === code);
    const status = await f.request({ type: 'bridge.status' });
    assert.equal(status.phase, code === 'VERSION_INCOMPATIBLE' ? 'incompatible' : 'disconnected');
    assert.equal(status.toolsReady, false);
    assert.equal(status.code, code);
  }
});

test('Native Messaging disconnect before handshake reports unavailable rather than a lost ready connection', async () => {
  const f = fixture();
  await settled(() => f.ports[0]?.sent.length);
  f.ports[0].disconnect();
  await settled(() => f.values.bridgeStatus === 'native_host_unavailable');
  const status = await f.request({ type: 'bridge.status' });
  assert.equal(status.phase, 'disconnected');
  assert.equal(status.toolsReady, false);
  assert.equal(status.code, 'native_host_unavailable');
});

test('invalid messages retain bounded failure evidence after reconnect and worker restart', async () => {
  const f = fixture();
  await settled(() => f.ports[0]?.sent.length);
  connect(f.ports[0]);
  f.ports[0].receive({
    type: 'request',
    method: 'browser_snapshot',
    params: { privateText: 'must-not-persist' },
  });
  await settled(() => f.values.bridgeStatus === 'invalid_message');
  const failure = (await f.request({ type: 'bridge.status' })).lastFailure;
  assert.equal(failure.code, 'invalid_message');
  assert.equal(failure.method, 'browser_snapshot');
  assert.equal(failure.nativeReason, null);
  assert.ok(Number.isFinite(Date.parse(failure.at)));
  assert.equal(JSON.stringify(f.values).includes('must-not-persist'), false);
  await f.request({ type: 'bridge.reconnect' });
  await settled(() => f.ports[1]?.sent.length);
  connect(f.ports[1]);
  assert.equal((await f.request({ type: 'bridge.status' })).phase, 'connected');
  assert.deepEqual((await f.request({ type: 'bridge.status' })).lastFailure, failure);
  const restarted = fixture(f.values);
  await settled(() => restarted.ports[0]?.sent.length);
  connect(restarted.ports[0]);
  assert.deepEqual((await restarted.request({ type: 'bridge.status' })).lastFailure, failure);
  await restarted.request({ type: 'bridge.pause', paused: true });
  assert.deepEqual((await restarted.request({ type: 'bridge.status' })).lastFailure, failure);
});

test('native errors are categorized without retaining paths, messages or arbitrary method names', async () => {
  const f = fixture();
  await settled(() => f.ports[0]?.sent.length);
  connect(f.ports[0]);
  f.browser.runtime.lastError = { message: 'Native host has exited: C:/private/secret-token' };
  f.ports[0].disconnect();
  await settled(() => f.values.bridgeStatus === 'disconnected');
  assert.equal((await f.request({ type: 'bridge.status' })).lastFailure.nativeReason, 'host_exited');
  assert.equal(JSON.stringify(f.values).includes('secret-token'), false);
  await f.request({ type: 'bridge.reconnect' });
  await settled(() => f.ports[1]?.sent.length);
  connect(f.ports[1]);
  f.ports[1].receive({ type: 'request', method: 'https://private.example/secret-token' });
  await settled(() => f.values.bridgeStatus === 'invalid_message');
  assert.equal((await f.request({ type: 'bridge.status' })).lastFailure.method, null);
  assert.equal(JSON.stringify(f.values).includes('secret-token'), false);
});
