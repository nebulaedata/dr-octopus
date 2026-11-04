/**
 * @author Codex
 * @description Regresses captured Native session senders, delayed replies, heartbeat recovery and owned listener disposal.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/native-bridge.ts', import.meta.url))],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  define: {
    'import.meta.env.BROWSER': '"chrome"',
    __OCTOPUS_BROWSER_HOST__: '"com.octopus.executor.browser"',
    __OCTOPUS_EXTENSION_BUILD_ID__: JSON.stringify('e'.repeat(64)),
  },
});

/**
 * Models real multi-listener event ownership and synchronous disconnection callbacks.
 */
function event() {
  const listeners = new Set();
  return {
    addListener: (listener) => listeners.add(listener),
    removeListener: (listener) => listeners.delete(listener),
    fire: (...args) => [...listeners].map((listener) => listener(...args)),
    get size() {
      return listeners.size;
    },
  };
}

/**
 * Creates an isolated connection owner with controlled browser events and clock, without starting business services.
 */
function fixture() {
  const ports = [];
  const values = {};
  const alarms = new Map();
  let now = Date.now();
  let disconnected = 0;
  const storageChanged = event();
  const browser = {
    runtime: {
      id: 'owned',
      getURL: (path) => `chrome-extension://owned${path}`,
      getManifest: () => ({ version: '1.0.0' }),
      onStartup: event(),
      onInstalled: event(),
      onMessage: event(),
      connectNative: () => {
        const port = {
          sent: [],
          onMessage: event(),
          onDisconnect: event(),
          postMessage(value) {
            this.sent.push(value);
          },
          disconnect() {
            this.onDisconnect.fire();
          },
        };
        ports.push(port);
        return port;
      },
    },
    storage: {
      onChanged: storageChanged,
      local: {
        get: async () => ({ ...values }),
        set: async (next) => {
          const changes = {};
          for (const [key, value] of Object.entries(next)) {
            if (values[key] !== value) {
              changes[key] = { newValue: value };
            }
            values[key] = value;
          }
          storageChanged.fire(changes, 'local');
        },
      },
    },
    alarms: {
      onAlarm: event(),
      create: async (name, value) => alarms.set(name, value),
      clear: async (name) => alarms.delete(name),
    },
  };
  const module = { exports: {} };
  class Clock extends Date {
    /**
     * Supplies a deterministic heartbeat clock without changing process-global time.
     */
    static now() {
      return now;
    }
  }
  new Function('require', 'module', 'exports', 'Date', bundle.outputFiles[0].text)(
    (name) => (name === 'wxt/browser' ? { browser } : require(name)),
    module,
    module.exports,
    Clock
  );
  const bridge = module.exports.createNativeBridge({ execute: async () => ({}), reset: () => {} });
  bridge.start({
    receive: () => false,
    disconnect: () => {
      disconnected++;
    },
  });
  /**
   * Answers only the emitted current handshake, preserving request correlation.
   */
  function connect(port) {
    port.onMessage.fire({
      type: 'connected',
      requestId: port.sent[0].requestId,
      version: 5,
      connectionId: randomUUID(),
      executorVersion: '1.0.0',
      hostBundleId: 'a'.repeat(64),
    });
  }
  return {
    bridge,
    ports,
    browser,
    alarms,
    connect,
    advance: (ms) => {
      now += ms;
    },
    disconnected: () => disconnected,
  };
}

/**
 * Drains controlled microtasks with a finite bound rather than guessed browser delays.
 */
async function settle(predicate) {
  for (let index = 0; index < 30; index++) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('Connection did not settle');
}

test('captured file senders reject after reconnection and never send through a replacement port', async (t) => {
  const f = fixture();
  t.after(() => f.bridge.dispose());
  await settle(() => f.ports[0]?.sent.length);
  f.connect(f.ports[0]);
  const old = f.bridge.getSession();
  assert(old);
  f.ports[0].disconnect();
  await settle(() => f.alarms.has('octopus-bridge-retry'));
  f.browser.alarms.onAlarm.fire({ name: 'octopus-bridge-retry' });
  await settle(() => f.ports[1]?.sent.length);
  f.connect(f.ports[1]);
  const current = f.bridge.getSession();
  assert.notEqual(current.id, old.id);
  assert.throws(() => old.post({ connectionId: old.id }), /SKILL_OFFLINE/);
  assert.equal(f.ports[1].sent.length, 1);
  f.ports[0].onMessage.fire({ type: 'error', requestId: null, code: 'VERSION_INCOMPATIBLE' });
  assert.equal((await f.bridge.readStatus()).phase, 'connected');
});

test('stalled connected port retries once and pause/dispose prevent future connection work', async () => {
  const f = fixture();
  try {
    await settle(() => f.ports[0]?.sent.length);
    f.connect(f.ports[0]);
    f.advance(46000);
    f.browser.alarms.onAlarm.fire({ name: 'octopus-bridge-heartbeat' });
    await settle(() => f.alarms.has('octopus-bridge-retry'));
    assert.equal((await f.bridge.readStatus()).code, 'heartbeat_timeout');
    await f.browser.storage.local.set({ paused: true });
    f.browser.alarms.onAlarm.fire({ name: 'octopus-bridge-retry' });
    await settle(() => f.alarms.size === 0);
    assert.equal(f.ports.length, 1);
  } finally {
    await f.bridge.dispose();
  }
  assert.equal(f.browser.runtime.onMessage.size, 0);
  assert.equal(f.browser.storage.onChanged.size, 0);
  assert.equal(f.browser.alarms.onAlarm.size, 0);
  assert.equal(f.bridge.getSession(), undefined);
});
