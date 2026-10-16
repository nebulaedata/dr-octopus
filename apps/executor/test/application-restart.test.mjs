/**
 * @author Codex
 * @description Verifies restart ordering, development supervision signals and the trusted finite IPC boundary without restarting the user's app.
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setImmediate as nextTurn } from 'node:timers/promises';
import test from 'node:test';
import { build } from 'esbuild';
import { developmentRestartExitCode, ipcChannels } from '../src/contracts/runtime.ts';

/**
 * Bundles the actual Main entry with isolated Electron lifecycle events; initialization stays pending.
 */
async function fixture(run, dev = false) {
  const data = await mkdtemp(join(tmpdir(), 'octopus-restart-'));
  const entry = fileURLToPath(new URL('../src/main/index.ts', import.meta.url));
  const root = fileURLToPath(new URL('../', import.meta.url));
  const events = [];
  const handlers = new Map();
  const app = Object.assign(new EventEmitter(), {
    isPackaged: false,
    setName() {},
    commandLine: {
      /**
       * Routes the actual Main resolver through this fixture's explicit isolated profile.
       */
      getSwitchValue(name) {
        return name === 'user-data-dir' ? data : '';
      },
    },
    /**
     * Verifies Main selects only the fixture's directory before constructing its Runtime.
     */
    setPath(name, path) {
      assert.equal(name, 'userData');
      assert.equal(path, data);
    },
    getAppPath: () => root,
    getPath: () => data,
    requestSingleInstanceLock: () => true,
    whenReady: () => new Promise(() => {}),
    quit() {
      events.push('quit');
      app.emit('before-quit', { preventDefault() {} });
    },
    relaunch() {
      events.push('relaunch');
    },
    exit(code) {
      events.push(['exit', code]);
    },
  });
  const electron = {
    app,
    nativeTheme: {},
    protocol: { registerSchemesAsPrivileged() {} },
    ipcMain: {
      handle: (name, fn) => handlers.set(name, fn),
      removeHandler: (name) => handlers.delete(name),
    },
  };
  const bundled = await build({
    stdin: {
      contents: (await readFile(entry, 'utf8')) + '\nexport { requestRestart, runtime, registerDesktopIpc };',
      resolveDir: dirname(entry),
      sourcefile: entry,
      loader: 'ts',
    },
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'cjs',
    write: false,
    define: {
      'import.meta.url': JSON.stringify(new URL('../src/main/index.ts', import.meta.url).href),
      'process.argv': JSON.stringify([
        'electron',
        root,
        '--user-data-dir=' + data,
        ...(dev ? ['--executor-dev'] : []),
      ]),
    },
  });
  const require = createRequire(import.meta.url);
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(
    (name) => (name === 'electron' ? electron : require(name)),
    module,
    module.exports
  );
  try {
    await run({ ...module.exports, events, handlers });
  } finally {
    await rm(data, { recursive: true, force: true });
  }
}

test('complete restart coalesces requests and relaunches only after confirmed Runtime exit', async () => {
  await fixture(async ({ requestRestart, runtime, events }) => {
    let drained;
    runtime.stop = () =>
      new Promise((resolve) => {
        drained = resolve;
      });
    assert.equal(requestRestart(), true);
    assert.equal(requestRestart(), false);
    await nextTurn();
    assert.deepEqual(events, ['quit']);
    drained();
    await nextTurn();
    assert.deepEqual(events, ['quit', 'relaunch', 'quit']);
  });
});

test('unconfirmed shutdown never relaunches; development restart signals the existing launcher', async () => {
  await fixture(async ({ requestRestart, runtime, events }) => {
    runtime.stop = async () => {
      throw new Error('unconfirmed');
    };
    requestRestart();
    await nextTurn();
    assert.deepEqual(events, ['quit', ['exit', 1]]);
  });
  await fixture(async ({ requestRestart, runtime, events }) => {
    runtime.stop = async () => {};
    requestRestart();
    await nextTurn();
    assert.deepEqual(events, ['quit', ['exit', developmentRestartExitCode]]);
  }, true);
});

test('restart IPC refuses foreign frames, arbitrary arguments, unsaved settings and saves during restart', async () => {
  await fixture(async ({ registerDesktopIpc, handlers }) => {
    const frame = { origin: 'app://ui' };
    const contents = { mainFrame: frame };
    const window = { isDestroyed: () => false, webContents: contents };
    const event = { sender: contents, senderFrame: frame };
    let pending = false;
    let saving = false;
    let requests = 0;
    const manager = {
      projectRoot: process.cwd(),
      readSettings: async () => ({ ok: true, data: { pendingRestart: pending } }),
      isSavingSettings: () => saving,
      subscribe: () => () => {},
      saveSettings: async () => {
        assert.fail('save must be blocked during restart');
      },
    };
    const unregister = registerDesktopIpc(manager, new Set([window]), 'app://ui', false, () => {
      requests++;
      return true;
    });
    const restart = handlers.get(ipcChannels.restartApplication);
    assert.equal((await restart({ sender: {}, senderFrame: frame }, {})).ok, false);
    assert.equal((await restart(event, { command: 'arbitrary' })).ok, false);
    assert.equal((await restart(event, {})).ok, false);
    pending = true;
    saving = true;
    assert.equal((await restart(event, {})).ok, false);
    assert.equal(requests, 0);
    saving = false;
    assert.deepEqual(await restart(event, {}), { ok: true });
    assert.equal((await restart(event, {})).ok, false);
    assert.equal(requests, 1);
    assert.equal((await handlers.get(ipcChannels.saveSettings)(event, {})).code, 'UNAVAILABLE');
    unregister();
    assert.equal(handlers.has(ipcChannels.restartApplication), false);
  });
});

test('development supervisor retains Vite during restart and never respawns after a stop signal', async () => {
  for (const stopping of [false, true]) {
    const children = [];
    let closed = 0;
    const processState = Object.assign(new EventEmitter(), { platform: 'win32', arch: 'x64' });
    globalThis.executorRestartFixture = {
      process: processState,
      async createServer() {
        return {
          async listen() {},
          async close() {
            closed++;
          },
        };
      },
      spawn(_path, _args, options) {
        assert.equal(options.shell, false);
        const child = new EventEmitter();
        child.kill = () => child.emit('exit', developmentRestartExitCode);
        children.push(child);
        return child;
      },
    };
    const entry = fileURLToPath(new URL('../scripts/compile/dev.mjs', import.meta.url));
    const bundled = await build({
      entryPoints: [entry],
      bundle: true,
      platform: 'node',
      format: 'esm',
      write: false,
      define: {
        process: 'globalThis.executorRestartFixture.process',
        'import.meta.url': JSON.stringify(new URL('../scripts/compile/dev.mjs', import.meta.url).href),
      },
      plugins: [
        {
          name: 'isolated-dev-runtime',
          setup(build) {
            build.onResolve({ filter: /^(node:child_process|node:module|vite)$/ }, (args) => ({
              path: args.path,
              namespace: 'fixture',
            }));
            build.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
              contents:
                args.path === 'vite'
                  ? 'export const createServer = globalThis.executorRestartFixture.createServer;'
                  : args.path === 'node:module'
                    ? 'export function createRequire() { return () => "owned-electron.exe"; }'
                    : 'export const spawn = globalThis.executorRestartFixture.spawn;',
            }));
            build.onLoad({ filter: /[\\/]compile[\\/]build\.mjs$/ }, () => ({
              contents: 'export async function buildProcesses() {}',
            }));
            build.onLoad({ filter: /application-api\.mjs$/ }, () => ({
              contents: `export const applicationApi = {developmentRestartExitCode: ${developmentRestartExitCode}};`,
            }));
          },
        },
      ],
    });
    const running = import(
      'data:text/javascript;base64,' +
        Buffer.from(bundled.outputFiles[0].text + '\n//' + randomUUID()).toString('base64')
    );
    try {
      for (let attempt = 0; !children.length && attempt < 20; attempt++) {
        await nextTurn();
      }
      assert.equal(children.length, 1);
      if (stopping) {
        processState.emit('SIGTERM');
      } else {
        children[0].emit('exit', developmentRestartExitCode);
        await nextTurn();
        assert.equal(children.length, 2);
        assert.equal(closed, 0);
        children[1].emit('exit', 0);
      }
      await running;
      assert.equal(closed, 1);
      assert.equal(processState.exitCode, 0);
      assert.equal(children.length, stopping ? 1 : 2);
      assert.equal(processState.listenerCount('SIGTERM'), 0);
    } finally {
      delete globalThis.executorRestartFixture;
    }
  }
});
