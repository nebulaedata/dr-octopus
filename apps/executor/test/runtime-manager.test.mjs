/**
 * @author Codex
 * @description Tests startup cancellation, failed health probes and refusal of late readiness after stop.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { build } from 'esbuild';

test('startup failure codes survive child exit without exposing child error text or accepting late readiness', async () => {
  const entry = new URL('../src/main/runtime-manager.ts', import.meta.url);
  const built = await build({
    entryPoints: [fileURLToPath(entry)],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
  });
  const child = new EventEmitter();
  child.pid = 314;
  const require = createRequire(import.meta.url);
  const module = { exports: {} };
  /**
   * Retains the real manager and contract validation with a single owned child transport.
   */
  const load = (id) => (id === 'electron' ? { utilityProcess: { fork: () => child } } : require(id));
  new Function('require', 'module', 'exports', built.outputFiles[0].text)(load, module, module.exports);
  const manager = new module.exports.RuntimeManager('unused', 'unused', 'unused');
  manager.snapshot.state = 'starting';
  const rejected = assert.rejects(manager.launch(), /before readiness/);
  child.emit('message', { type: 'startup-failed', code: 'CONTROL_STORE_INVALID', message: 'secret' });
  assert.equal(manager.readStatus().startupFailure, null);
  const diagnostic = {
    stage: 'mcp-listen',
    address: '192.168.0.78',
    port: 19876,
    systemCode: 'EADDRNOTAVAIL',
  };
  child.emit('message', { type: 'startup-failed', code: 'MCP_LISTEN_FAILED', listenFailure: diagnostic });
  child.emit('exit', 1);
  await rejected;
  assert.equal(manager.readStatus().state, 'failed');
  assert.equal(manager.readStatus().startupFailure, 'MCP_LISTEN_FAILED');
  assert.deepEqual(manager.readStatus().listenFailure, diagnostic);
  assert.equal(manager.readStatus().message, '执行服务初始化失败');
  assert.ok(!JSON.stringify(manager.readStatus()).includes('secret'));
});

test('startup deadline kills only the owned child, preserves timeout and refuses late readiness', async (context) => {
  const built = await build({
    entryPoints: [fileURLToPath(new URL('../src/main/runtime-manager.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
  });
  const child = new EventEmitter();
  child.pid = 314;
  let kills = 0;
  child.kill = () => {
    kills += 1;
  };
  const require = createRequire(import.meta.url);
  const module = { exports: {} };
  /**
   * Retains production lifecycle handlers with one isolated Utility process.
   */
  const load = (id) => (id === 'electron' ? { utilityProcess: { fork: () => child } } : require(id));
  new Function('require', 'module', 'exports', built.outputFiles[0].text)(load, module, module.exports);
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const manager = new module.exports.RuntimeManager('unused', 'unused', 'unused');
  manager.snapshot.state = 'starting';
  const rejected = assert.rejects(manager.launch(), /startup timed out/);
  context.mock.timers.tick(44_999);
  assert.equal(manager.readStatus().state, 'starting');
  assert.equal(kills, 0);
  context.mock.timers.tick(1);
  await rejected;
  assert.equal(kills, 1);
  child.emit('message', {
    type: 'ready',
    pid: 314,
    startedAt: new Date().toISOString(),
    endpoint: 'http://127.0.0.1:19876/mcp',
    computer: { state: 'starting', available: false, reason: '桌面后端启动中' },
  });
  assert.equal(manager.readStatus().state, 'failed');
  child.emit('exit', 1);
  assert.equal(manager.readStatus().message, '执行服务启动超时');
  assert.equal(manager.readStatus().pid, null);
});

test('manager cancels pending startup, reports failed health and refuses late probe success after stop', async () => {
  const entry = new URL('../src/main/runtime-manager.ts', import.meta.url);
  const built = await build({
    entryPoints: [fileURLToPath(entry)],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    define: { 'import.meta.url': JSON.stringify(entry.href) },
  });
  let launches = 0;
  const require = createRequire(import.meta.url);
  const module = { exports: {} };
  /**
   * Replaces only Electron process creation while retaining the production manager and contracts.
   */
  const load = (id) =>
    id === 'electron'
      ? {
          utilityProcess: {
            /**
             * Detects any process creation after startup admission has closed.
             */
            fork() {
              launches += 1;
              throw new Error('Unexpected launch after stop');
            },
          },
        }
      : require(id);
  new Function('require', 'module', 'exports', built.outputFiles[0].text)(load, module, module.exports);
  for (const failed of [false, true]) {
    const manager = new module.exports.RuntimeManager('unused', 'unused', 'unused');
    let complete;
    manager.loadSettings = () =>
      new Promise((resolve, reject) => {
        complete = failed
          ? () => reject(new Error('Settings unavailable'))
          : () => resolve({ read: () => ({ port: 19876, networkAddress: null, saved: false }) });
      });
    const starting = manager.start();
    const rejected = assert.rejects(starting);
    await manager.stop();
    complete();
    await rejected;
    assert.equal(manager.readStatus().state, 'stopped');
    assert.equal(manager.readStatus().pid, null);
  }
  assert.equal(launches, 0);
  const manager = new module.exports.RuntimeManager('unused', 'unused', 'unused');
  manager.snapshot.state = 'ready';
  manager.child = {};
  manager.request = async (_input, timeout) => {
    assert.equal(timeout, 5000);
    throw new Error('Probe timed out');
  };
  await manager.checkHealth();
  assert.equal(manager.readStatus().health.state, 'unresponsive');
  assert.equal(manager.readStatus().capabilities.computer.available, false);
  assert.equal(manager.readStatus().capabilities.computer.state, 'unavailable');
  manager.request = async () => ({
    computer: { state: 'ready', available: true, reason: '桌面工具就绪' },
    response: {
      ok: true,
      data: {
        endpoint: 'http://127.0.0.1:19876/mcp',
        browser: { enabled: true, connections: [{ state: 'connected', toolsAvailable: true }] },
      },
    },
  });
  await manager.checkHealth();
  assert.equal(manager.readStatus().health.state, 'healthy');
  assert.equal(manager.readStatus().capabilities.browser.available, true);
  assert.equal(manager.readStatus().capabilities.computer.available, true);
  assert.equal(manager.readStatus().capabilities.computer.state, 'ready');
  for (const state of ['failed', 'unavailable']) {
    manager.request = async () => ({
      computer: { state, available: false, reason: 'Desktop is unavailable' },
      response: {
        ok: true,
        data: {
          endpoint: 'http://127.0.0.1:19876/mcp',
          browser: { enabled: true, connections: [{ state: 'connected', toolsAvailable: true }] },
        },
      },
    });
    await manager.checkHealth();
    assert.equal(manager.readStatus().health.state, 'healthy');
    assert.equal(manager.readStatus().capabilities.browser.available, true);
    assert.equal(manager.readStatus().capabilities.computer.state, state);
    assert.equal(manager.readStatus().capabilities.computer.available, false);
  }
  let completeProbe;
  manager.request = () =>
    new Promise((resolve) => {
      completeProbe = resolve;
    });
  const checking = manager.checkHealth();
  manager.update({ state: 'stopped' });
  completeProbe({
    computer: { state: 'ready', available: true, reason: '桌面工具就绪' },
    response: {
      ok: true,
      data: {
        endpoint: 'http://127.0.0.1:19876/mcp',
        browser: { enabled: false, connections: [] },
      },
    },
  });
  await checking;
  assert.equal(manager.readStatus().health.state, 'unknown');
  assert.equal(manager.readStatus().capabilities.computer.available, false);
  assert.equal(manager.readStatus().capabilities.computer.state, 'stopped');
});

test('computer feedback accepts only current Runtime identity and increasing revisions; exit retains uncertainty', async () => {
  const entry = new URL('../src/main/runtime-manager.ts', import.meta.url);
  const built = await build({
    entryPoints: [fileURLToPath(entry)],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
  });
  const child = new EventEmitter();
  child.pid = 314;
  const require = createRequire(import.meta.url);
  const module = { exports: {} };
  /**
   * Supplies one owned Runtime event source while retaining the actual message validation and lifecycle logic.
   */
  const load = (id) => (id === 'electron' ? { utilityProcess: { fork: () => child } } : require(id));
  new Function('require', 'module', 'exports', built.outputFiles[0].text)(load, module, module.exports);
  const manager = new module.exports.RuntimeManager('unused', 'unused', 'unused');
  manager.snapshot.state = 'starting';
  const started = manager.launch();
  child.emit('message', {
    type: 'ready',
    pid: 314,
    startedAt: new Date().toISOString(),
    endpoint: 'http://127.0.0.1:19876/mcp',
    computer: { state: 'starting', available: false, reason: '桌面后端启动中' },
  });
  await started;
  const activity = {
    revision: 1,
    activityId: '00000000-0000-4000-8000-000000000011',
    state: 'running',
    activeCalls: 0,
    activeTasks: 1,
  };
  child.emit('message', { type: 'computer-use', pid: 315, activity });
  assert.equal(manager.readStatus().computerUse.state, 'idle');
  child.emit('message', { type: 'computer-use', pid: 314, activity });
  assert.equal(manager.readStatus().computerUse.state, 'running');
  const localStops = [];
  child.postMessage = (message) => localStops.push(message);
  assert.equal(manager.stopComputerUse(activity.activityId, 315), false);
  assert.equal(manager.stopComputerUse('00000000-0000-4000-8000-000000000099', 314), false);
  assert.equal(localStops.length, 0);
  assert.equal(manager.stopComputerUse(activity.activityId, 314), true);
  assert.deepEqual(localStops, [{ type: 'computer-stop', activityId: activity.activityId }]);
  child.emit('message', {
    type: 'computer-use',
    pid: 314,
    activity: { revision: 1, activityId: null, state: 'idle', activeCalls: 0 },
  });
  assert.equal(manager.readStatus().computerUse.state, 'running');
  child.emit('exit', 1);
  assert.equal(manager.readStatus().computerUse.state, 'unknown');
  assert.equal(manager.stopComputerUse(activity.activityId, 314), false);
  child.emit('message', {
    type: 'computer-use',
    pid: 314,
    activity: { revision: 99, activityId: null, state: 'idle', activeCalls: 0 },
  });
  assert.equal(manager.readStatus().computerUse.state, 'unknown');
});

test('policy publication refuses stale drafts and never confirms an unacknowledged Runtime revision', async () => {
  const built = await build({
    entryPoints: [fileURLToPath(new URL('../src/main/runtime-manager.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
  });
  const require = createRequire(import.meta.url);
  const module = { exports: {} };
  /**
   * Leaves policy publication and lifecycle admission intact while replacing only Electron transport.
   */
  const load = (id) => (id === 'electron' ? { utilityProcess: {} } : require(id));
  new Function('require', 'module', 'exports', built.outputFiles[0].text)(load, module, module.exports);
  const manager = new module.exports.RuntimeManager('unused', 'unused', 'unused');
  let saved = { revision: 0, selectedId: 'readonly', custom: [] };
  manager.loadSettings = async () => ({
    readToolPolicies: () => structuredClone(saved),
    saveToolPolicies: async (next) => {
      saved = structuredClone(next);
    },
  });
  manager.snapshot.state = 'ready';
  manager.child = {};
  manager.request = async () => {
    throw new Error('lost acknowledgement');
  };
  const input = { ...saved, selectedId: 'all' };
  assert.equal((await manager.saveToolPolicies(input)).ok, false);
  assert.equal(saved.selectedId, 'all');
  assert.equal(saved.revision, 1);
  assert.equal((await manager.readToolPolicies()).data.applied, false);
  assert.equal((await manager.saveToolPolicies(input)).ok, false);
  assert.equal(saved.revision, 1);

  let confirm;
  manager.request = (request) =>
    new Promise((resolve) => {
      assert.equal(request.type, 'tool-policy-set');
      assert.ok(request.enabledTools.includes('write'));
      confirm = () => resolve({ response: { ok: true, data: { toolPolicyRevision: request.revision } } });
    });
  const publishing = manager.saveToolPolicies(saved);
  while (!confirm) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(manager.isSavingSettings(), true);
  assert.equal((await manager.saveToolPolicies(saved)).ok, false);
  await assert.rejects(manager.start(), /publication/);
  confirm();
  assert.equal((await publishing).data.applied, true);
  assert.equal(manager.isSavingSettings(), false);
  manager.snapshot.state = 'starting';
  assert.equal((await manager.saveToolPolicies(saved)).ok, false);
});
