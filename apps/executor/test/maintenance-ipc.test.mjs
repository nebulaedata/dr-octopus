/**
 * @author Codex
 * @description Verifies trusted finite recovery IPC, stale-state forwarding and teardown without touching real user storage.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { ipcChannels } from '../src/contracts/runtime.ts';
import { defaultToolPolicySettings } from '../src/contracts/tool-policy.ts';

test('maintenance handlers validate frame, action and revision and serialize with saved settings', async () => {
  const data = await mkdtemp(join(tmpdir(), 'octopus-maintenance-ipc-'));
  const handlers = new Map();
  const calls = [];
  const frame = { origin: 'app://ui' };
  const contents = { mainFrame: frame };
  const window = { isDestroyed: () => false, webContents: contents };
  const event = { sender: contents, senderFrame: frame };
  let interfaceSnapshot = { Ethernet: [{ address: '192.168.14.100', family: 'IPv4', internal: false }] };
  let discoveryFailed = false;
  let savedNetworkAddress = null;
  let saving = false;
  let busy = false;
  const entry = new URL('../src/main/desktop-ipc.ts', import.meta.url);
  const built = await build({
    entryPoints: [fileURLToPath(entry)],
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'cjs',
    write: false,
    define: { 'import.meta.url': JSON.stringify(entry.href) },
  });
  const require = createRequire(import.meta.url);
  const module = { exports: {} };
  const electron = {
    app: { isPackaged: false, getAppPath: () => fileURLToPath(new URL('../', import.meta.url)) },
    ipcMain: {
      handle: (name, handler) => handlers.set(name, handler),
      removeHandler: (name) => handlers.delete(name),
    },
    clipboard: { writeText: (text) => calls.push(['clipboard', text]) },
    nativeTheme: { themeSource: 'system' },
  };
  /**
   * Replaces only desktop side effects; the production sender checks, schemas and handlers remain intact.
   */
  const load = (name) => {
    if (name === 'electron') {
      return electron;
    }
    if (name === 'node:os') {
      return {
        ...require(name),
        networkInterfaces: () => {
          if (discoveryFailed) {
            throw new Error('secret OS exception');
          }
          return interfaceSnapshot;
        },
      };
    }
    return require(name);
  };
  new Function('require', 'module', 'exports', built.outputFiles[0].text)(load, module, module.exports);
  try {
    const recovery = {
      read: () => ({ phase: 'idle', message: '', backupPath: null, issue: null }),
      isBusy: () => busy,
      run: async (...args) => {
        calls.push(args);
      },
      dismiss: () => {
        calls.push(['dismiss']);
      },
    };
    const manager = {
      projectRoot: data,
      subscribe: () => () => {},
      isSavingSettings: () => saving,
      readToolPolicies: async () => ({ ok: true, data: { settings: defaultToolPolicySettings } }),
      saveToolPolicies: async (input) => {
        calls.push(['policy', input.selectedId]);
        return { ok: true };
      },
      readSettings: async () => ({ ok: true, data: { pendingRestart: true } }),
      saveSettings: async (input) => {
        savedNetworkAddress = input.networkAddress;
        return { ok: true, data: { themeSource: 'system' } };
      },
    };
    const unregister = module.exports.registerDesktopIpc(
      manager,
      new Set([window]),
      'app://ui',
      false,
      () => true,
      recovery
    );
    const policyRead = handlers.get(ipcChannels.readToolPolicies);
    const policySave = handlers.get(ipcChannels.saveToolPolicies);
    assert.equal((await policyRead(event, {})).ok, true);
    assert.equal((await policyRead(event, { unexpected: true })).ok, false);
    assert.equal((await policyRead({ sender: {}, senderFrame: frame }, {})).ok, false);
    assert.equal((await policySave({ sender: {}, senderFrame: frame }, defaultToolPolicySettings)).ok, false);
    assert.equal(
      (await policySave(event, { ...defaultToolPolicySettings, selectedId: 'unknown' })).ok,
      false
    );
    busy = true;
    assert.equal((await policySave(event, defaultToolPolicySettings)).ok, false);
    busy = false;
    assert.deepEqual(calls, []);
    assert.equal((await policySave(event, defaultToolPolicySettings)).ok, true);
    assert.deepEqual(calls.pop(), ['policy', 'readonly']);
    const read = handlers.get(ipcChannels.readMaintenance);
    const action = handlers.get(ipcChannels.maintenanceAction);
    for (const foreign of [
      { sender: {}, senderFrame: frame },
      { sender: contents, senderFrame: { origin: 'app://ui' } },
      { sender: contents, senderFrame: { origin: 'https://foreign' } },
    ]) {
      assert.equal(read(foreign, {}).ok, false);
      assert.equal((await action(foreign, { action: 'reset', revision: 3 })).ok, false);
    }
    for (const input of [
      { action: 'reset', revision: 3, path: data },
      { action: 'erase-all', revision: 3 },
      { action: 'reset', revision: -1 },
    ]) {
      assert.equal((await action(event, input)).ok, false);
    }
    assert.deepEqual(calls, []);
    saving = true;
    assert.equal((await action(event, { action: 'reset', revision: 3 })).ok, false);
    saving = false;
    assert.equal((await action(event, { action: 'reset', revision: 3 })).ok, true);
    assert.deepEqual(calls, [['reset', 3]]);
    busy = true;
    assert.equal((await handlers.get(ipcChannels.restartApplication)(event, {})).ok, false);
    assert.equal((await action(event, { action: 'open-backup', revision: 3 })).ok, false);
    const discover = handlers.get(ipcChannels.readNetworkAddresses);
    const save = handlers.get(ipcChannels.saveSettings);
    for (const foreign of [
      { sender: {}, senderFrame: frame },
      { sender: contents, senderFrame: { origin: 'app://ui' } },
    ]) {
      assert.equal(discover(foreign, {}).code, 'FORBIDDEN');
      assert.equal(
        (await save(foreign, { port: 19876, networkAddress: '192.168.14.100' })).code,
        'FORBIDDEN'
      );
    }
    assert.equal(discover(event, { command: 'scan' }).code, 'INVALID_REQUEST');
    assert.deepEqual(discover(event, {}).data, [{ address: '192.168.14.100', interfaceName: 'Ethernet' }]);
    busy = false;
    const input = { port: 19876, networkAddress: '192.168.14.100' };
    interfaceSnapshot = {};
    assert.equal((await save(event, input)).code, 'INVALID_REQUEST');
    assert.equal(savedNetworkAddress, null);
    discoveryFailed = true;
    assert.equal(discover(event, {}).code, 'UNAVAILABLE');
    assert.ok(!JSON.stringify(discover(event, {})).includes('secret'));
    assert.equal((await save(event, input)).code, 'UNAVAILABLE');
    // Local-only settings remain saveable even if OS discovery is unavailable.
    assert.equal((await save(event, { port: 19876, networkAddress: null })).ok, true);
    discoveryFailed = false;
    interfaceSnapshot = { Ethernet: [{ address: input.networkAddress, family: 'IPv4', internal: false }] };
    assert.equal((await save(event, input)).ok, true);
    assert.equal(savedNetworkAddress, input.networkAddress);
    unregister();
    assert.equal(handlers.size, 0);
  } finally {
    assert.ok(data.startsWith(join(tmpdir(), 'octopus-maintenance-ipc-')));
    await rm(data, { recursive: true, force: true });
  }
});
