/**
 * @author Codex
 * @description Exercises production bridge isolation, private consent history and the real private-Node native launcher.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { BrowserBridge } from '../../src/runtime/browser/browser-bridge.ts';
import { BridgeStore } from '../../src/runtime/browser/bridge-store.ts';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';
import { HttpGateway } from '../../src/runtime/mcp/http-gateway.ts';
import { readFrames, writeFrame } from '../../src/bridge/native-framing.ts';
import { browserIdentity } from '../../build/browser-identity.ts';
const browserExtensionId = browserIdentity.chromeExtensionId;
const foreignId = 'abcdefghijklmnop'
  .split('')
  .map((letter) => letter.repeat(32))
  .find((id) => !browserIdentity.allowedOrigins.includes(`chrome-extension://${id}/`));
const dist = fileURLToPath(new URL('../../dist/', import.meta.url));
/**
 * Owns isolated data and a real HTTP Gateway; MCP credentials cannot authenticate the separate bridge.
 */
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'octopus-browser-unit-'));
  const native = new NativeFileCommit(join(dist, 'native/file-commit.node'));
  const store = await BridgeStore.open(native, root);
  const bridge = new BrowserBridge(store);
  const gateway = new HttpGateway(
    {
      close: async () => {},
      authenticate: () => {
        throw new Error('MCP credentials required');
      },
    },
    bridge
  );
  const endpoint = await gateway.listen(0);
  await bridge.initialize(endpoint);
  try {
    await run({
      root,
      native,
      store,
      bridge,
      gateway,
      endpoint,
      /**
       * Loads this test's exact latest immutable credential without returning it to a product renderer.
       */
      record: async () =>
        JSON.parse(await readFile(join(store.root, (await readdir(store.root)).sort().at(-1)), 'utf8')),
    });
  } finally {
    await gateway.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
/**
 * Builds protocol headers only from the test's protected bootstrap.
 */
function headers(record) {
  return {
    Authorization: `Bearer ${record.credential}`,
    'Content-Type': 'application/json',
    'X-Octopus-Role': 'native-browser-host',
    'X-Octopus-Origin': `chrome-extension://${browserExtensionId}/`,
    'X-Octopus-Login': record.loginIdentity,
  };
}
/**
 * Creates one installation handshake with an independently generated correlation identifier.
 */
function hello(version = 3) {
  return {
    type: 'hello',
    requestId: randomUUID(),
    version,
    tools: true,
    installationId: randomUUID(),
    browser: 'chrome',
    extensionVersion: '0.1.0',
  };
}
test('bridge bounds malformed payloads and sixteen installations, and revocation rejects a partially received handshake', async () =>
  fixture(async ({ bridge, record }) => {
    await bridge.setEnabled(true);
    const config = await record();
    for (const body of ['{bad', JSON.stringify({ ...hello(), injected: true })]) {
      assert.equal(
        (await fetch(config.endpoint, { method: 'POST', headers: headers(config), body })).status,
        400
      );
    }
    const oversized = await fetch(config.endpoint, {
      method: 'POST',
      headers: headers(config),
      body: JSON.stringify({ content: 'a'.repeat(256 * 1024) }),
    });
    assert.equal(oversized.status, 413);
    for (let index = 0; index < 16; index++) {
      assert.equal(
        (
          await fetch(config.endpoint, {
            method: 'POST',
            headers: headers(config),
            body: JSON.stringify(hello()),
          })
        ).status,
        200
      );
    }
    assert.equal(
      (
        await fetch(config.endpoint, {
          method: 'POST',
          headers: headers(config),
          body: JSON.stringify(hello()),
        })
      ).status,
      429
    );
    assert.equal(bridge.snapshot().connections.length, 16);
    const body = JSON.stringify(hello());
    let finish;
    const received = new Promise((resolve, reject) => {
      const request = httpRequest(
        config.endpoint,
        { method: 'POST', headers: { ...headers(config), 'Content-Length': Buffer.byteLength(body) } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        }
      );
      request.on('error', reject);
      request.write(body.slice(0, 10));
      finish = () => request.end(body.slice(10));
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    await bridge.setEnabled(false);
    finish();
    assert.equal(await received, 410);
    assert.equal(
      bridge.snapshot().connections.every((item) => item.state === 'disconnected'),
      true
    );
  }));
test('bridge rejects origins, wrong credentials/roles/login, and persists explicit consent without tool availability', async () =>
  fixture(async ({ bridge, record, native, root }) => {
    const first = await record();
    const post = (extra = {}) =>
      fetch(first.endpoint, {
        method: 'POST',
        headers: { ...headers(first), ...extra },
        body: JSON.stringify(hello()),
      });
    assert.equal((await post()).status, 403);
    await bridge.setEnabled(true);
    const current = await record();
    assert.equal((await post()).status, 401);
    for (const extra of [
      { Authorization: 'Bearer ' + 'a'.repeat(64) },
      { 'X-Octopus-Role': 'mcp-client-adapter' },
      { 'X-Octopus-Origin': `chrome-extension://${foreignId}/` },
      { 'X-Octopus-Login': '0:0:0' },
      { Origin: 'https://example.com' },
    ]) {
      assert.ok(
        [401, 403].includes(
          (
            await fetch(current.endpoint, {
              method: 'POST',
              headers: { ...headers(current), ...extra },
              body: JSON.stringify(hello()),
            })
          ).status
        )
      );
    }
    assert.equal(
      (
        await fetch(current.endpoint.replace('/browser-bridge', '/mcp'), {
          method: 'POST',
          headers: headers(current),
          body: '{}',
        })
      ).status,
      401
    );
    assert.equal((await native.inspect(join(root, 'browser'))).privateAcl, true);
    assert.equal((await BridgeStore.open(native, root)).enabled(), true);
  }));

test('plugin product upgrades and downgrades reconnect without client version coupling or stale session reuse', async () =>
  fixture(async ({ bridge, record }) => {
    await bridge.setEnabled(true);
    const config = await record();
    const body = hello();
    let previous;
    for (const extensionVersion of ['0.1.0', '0.2.0', '0.1.0']) {
      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: headers(config),
        body: JSON.stringify({ ...body, extensionVersion }),
      });
      assert.equal(response.status, 200);
      const connected = await response.json();
      assert.equal(bridge.snapshot().connections[0].extensionVersion, extensionVersion);
      if (previous) {
        assert.notEqual(connected.connectionId, previous);
        const stale = await fetch(config.endpoint, {
          headers: {
            ...headers(config),
            'X-Octopus-Connection': previous,
            'X-Octopus-Request': randomUUID(),
          },
        });
        assert.equal(stale.status, 410);
      }
      previous = connected.connectionId;
    }
    const incompatible = await fetch(config.endpoint, {
      method: 'POST',
      headers: headers(config),
      body: JSON.stringify({ ...body, version: body.version + 1, extensionVersion: '0.3.0' }),
    });
    assert.equal(incompatible.status, 409);
    assert.equal((await incompatible.json()).code, 'VERSION_INCOMPATIBLE');
    assert.equal(bridge.snapshot().connections[0].toolsAvailable, false);
  }));

test('version mismatch is visible and replacement sessions reject stale replies and duplicate polls', async () =>
  fixture(async ({ bridge, record }) => {
    await bridge.setEnabled(true);
    const config = await record();
    const body = hello(1);
    delete body.tools;
    const post = (value) =>
      fetch(config.endpoint, { method: 'POST', headers: headers(config), body: JSON.stringify(value) });
    assert.equal((await post(body)).status, 409);
    assert.equal(bridge.snapshot().connections[0].state, 'incompatible');
    body.version = 3;
    body.tools = true;
    const old = await (await post(body)).json();
    const fresh = await (await post(body)).json();
    const oldPoll = await fetch(config.endpoint, {
      headers: {
        ...headers(config),
        'X-Octopus-Connection': old.connectionId,
        'X-Octopus-Request': randomUUID(),
      },
    });
    assert.equal(oldPoll.status, 410);
    assert.notEqual(old.connectionId, fresh.connectionId);
    const polling = fetch(config.endpoint, {
      headers: {
        ...headers(config),
        'X-Octopus-Connection': fresh.connectionId,
        'X-Octopus-Request': randomUUID(),
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      (
        await fetch(config.endpoint, {
          headers: {
            ...headers(config),
            'X-Octopus-Connection': fresh.connectionId,
            'X-Octopus-Request': randomUUID(),
          },
        })
      ).status,
      429
    );
    await bridge.setEnabled(false);
    assert.equal((await polling).status, 410);
    assert.equal(bridge.snapshot().connections[0].state, 'disconnected');
  }));
test(
  'real launcher uses private Node, validates login/source and exits on protocol EOF',
  { timeout: 30000 },
  async () =>
    fixture(async ({ root, bridge, record }) => {
      const resource = join(root, 'package');
      for (const directory of ['native', 'bridge', 'resources/node']) {
        await mkdir(join(resource, directory), { recursive: true });
      }
      for (const path of [
        'native/browser-launcher.exe',
        'native/file-commit.node',
        'bridge/native-host.cjs',
        'resources/node/node.exe',
      ]) {
        await copyFile(join(dist, path), join(resource, path));
      }
      await writeFile(join(resource, 'bridge/host-location.json'), JSON.stringify({ projectRoot: root }));
      await bridge.setEnabled(true);
      const launcher = join(resource, 'native/browser-launcher.exe');
      const child = spawn(launcher, [`chrome-extension://${browserExtensionId}/`], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          NODE_OPTIONS: '--invalid-node-option',
          BROWSER_IDENTITY_PROFILE: 'store',
          BROWSER_CHROME_EXTENSION_ID: foreignId,
          BROWSER_EDGE_EXTENSION_ID: foreignId,
        },
      });
      child.stderr.resume();
      const exit = once(child, 'exit');
      const reader = readFrames(child.stdout);
      try {
        const body = hello();
        await writeFrame(child.stdin, body);
        const connected = (await reader.next()).value;
        assert.equal(connected.type, 'connected');
        assert.equal(connected.requestId, body.requestId);
        const requestId = randomUUID();
        await writeFrame(child.stdin, { type: 'heartbeat', requestId, connectionId: connected.connectionId });
        const reply = (await reader.next()).value;
        assert.equal(reply.requestId, requestId);
        child.stdin.end();
        assert.equal((await exit)[0], 0);
        assert.equal(bridge.snapshot().connections[0].state, 'disconnected');
        const wrong = spawn(launcher, [`chrome-extension://${foreignId}/`], {
          windowsHide: true,
          stdio: 'ignore',
          env: {
            ...process.env,
            BROWSER_CHROME_EXTENSION_ID: foreignId,
            BROWSER_EDGE_EXTENSION_ID: foreignId,
          },
        });
        assert.equal((await once(wrong, 'exit'))[0], 2);
        const config = await record();
        const native = new NativeFileCommit(join(dist, 'native/file-commit.node'));
        await native.writePrivateConfig(
          join(root, 'browser', `${String(config.sequence + 1).padStart(4, '0')}.json`),
          JSON.stringify({ ...config, sequence: config.sequence + 1, loginIdentity: '0:0:0' })
        );
        const mismatch = spawn(launcher, [`chrome-extension://${browserExtensionId}/`], {
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'ignore'],
        });
        mismatch.stdout.resume();
        mismatch.stdin.end();
        assert.equal((await once(mismatch, 'exit'))[0], 1);
      } finally {
        if (child.exitCode === null) {
          child.kill();
          await exit;
        }
      }
    })
);

test('every official browser origin reaches the real Host while runtime environment overrides cannot expand admission', async () =>
  fixture(async ({ root, bridge }) => {
    await bridge.setEnabled(true);
    const resource = join(root, 'multiple-origins');
    for (const directory of ['native', 'bridge', 'resources/node']) {
      await mkdir(join(resource, directory), { recursive: true });
    }
    for (const path of [
      'native/browser-launcher.exe',
      'native/file-commit.node',
      'bridge/native-host.cjs',
      'resources/node/node.exe',
    ]) {
      await copyFile(join(dist, path), join(resource, path));
    }
    await writeFile(join(resource, 'bridge/host-location.json'), JSON.stringify({ projectRoot: root }));
    const launcher = join(resource, 'native/browser-launcher.exe');
    for (const origin of browserIdentity.allowedOrigins) {
      const child = spawn(launcher, [origin], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'],
        env: {
          ...process.env,
          BROWSER_IDENTITY_PROFILE: 'invalid-runtime-value',
          BROWSER_CHROME_EXTENSION_ID: foreignId,
          BROWSER_EDGE_EXTENSION_ID: foreignId,
        },
      });
      const exit = once(child, 'exit');
      const reader = readFrames(child.stdout);
      try {
        const request = hello();
        if (origin === `chrome-extension://${browserIdentity.edgeExtensionId}/`) {
          request.browser = 'edge';
        }
        await writeFrame(child.stdin, request);
        const connected = (await reader.next()).value;
        assert.equal(connected.type, 'connected');
        assert.equal(connected.requestId, request.requestId);
        child.stdin.end();
        assert.equal((await exit)[0], 0);
      } finally {
        if (child.exitCode === null) {
          child.kill();
          await exit;
        }
      }
    }
  }));

test('finite dispatch correlates reversed replies and rejects an old connection result without replay', async () =>
  fixture(async ({ bridge, record }) => {
    await bridge.setEnabled(true);
    const config = await record();
    const installation = hello();
    const post = (value) =>
      fetch(config.endpoint, { method: 'POST', headers: headers(config), body: JSON.stringify(value) });
    const connected = await (await post(installation)).json();
    const poll = () =>
      fetch(config.endpoint, {
        headers: {
          ...headers(config),
          'X-Octopus-Connection': connected.connectionId,
          'X-Octopus-Request': randomUUID(),
        },
      }).then((response) => response.json());
    const first = bridge.call(connected.connectionId, 'browser_tabs', {});
    const one = await poll();
    const second = bridge.call(connected.connectionId, 'browser_tabs', {});
    const two = await poll();
    assert.notEqual(one.requestId, two.requestId);
    const reply = (value) =>
      fetch(config.endpoint, {
        method: 'POST',
        headers: { ...headers(config), 'X-Octopus-Connection': connected.connectionId },
        body: JSON.stringify(value),
      });
    assert.equal(
      (
        await reply({
          type: 'result',
          connectionId: connected.connectionId,
          requestId: two.requestId,
          result: { tabs: ['second'] },
        })
      ).status,
      200
    );
    assert.equal(
      (
        await reply({
          type: 'result',
          connectionId: connected.connectionId,
          requestId: one.requestId,
          result: { tabs: ['first'] },
        })
      ).status,
      200
    );
    assert.deepEqual(await first, { tabs: ['first'] });
    assert.deepEqual(await second, { tabs: ['second'] });
    const taskId = randomUUID();
    const release = bridge.release(connected.connectionId, taskId);
    const cleanup = await poll();
    assert.equal(cleanup.type, 'release');
    assert.equal(cleanup.taskId, taskId);
    await reply({
      type: 'result',
      connectionId: connected.connectionId,
      requestId: cleanup.requestId,
      result: { released: true },
    });
    assert.deepEqual(await release, { released: true });
    const unknown = bridge.call(connected.connectionId, 'browser_click', {
      tabId: 1,
      target: { documentId: 'old', controllerId: randomUUID(), snapshotId: randomUUID(), elementIndex: 1 },
    });
    const refused = assert.rejects(unknown, (error) => error.code === 'OUTCOME_UNKNOWN');
    const old = await poll();
    const fresh = await (await post(installation)).json();
    await refused;
    assert.equal(
      (
        await reply({
          type: 'result',
          connectionId: connected.connectionId,
          requestId: old.requestId,
          result: { businessEffect: 'applied', code: 'late' },
        })
      ).status,
      410
    );
    assert.throws(() => bridge.call(fresh.connectionId, 'execute_javascript', {}));
  }));
