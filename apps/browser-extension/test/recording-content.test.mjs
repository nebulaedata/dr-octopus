/**
 * @author Codex
 * @description Exercises production content-runtime replies across session replacement without a browser or real timers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/recording/recording-content.tsx', import.meta.url))],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  plugins: [
    {
      name: 'recording-ui-fixture',
      /**
       * Replaces only rendering and CSS while keeping the actual content runtime and recorder code.
       */
      setup(build) {
        build.onResolve({ filter: /features\/recording\/RecordingToolbar$/ }, () => ({
          path: 'fixture-recording-ui',
          external: true,
        }));
        build.onResolve({ filter: /\.css\?inline$/ }, () => ({ path: 'style', namespace: 'fixture-style' }));
        build.onLoad({ filter: /.*/, namespace: 'fixture-style' }, () => ({
          contents: 'export default "";',
          loader: 'js',
        }));
      },
    },
  ],
});

/**
 * Creates a deterministic session sufficient for projection and transport ownership checks.
 */
function session(id) {
  return { id, status: 'recording', epoch: 1, updatedAt: 1, pages: [], gaps: [], resumedAt: 1, elapsedMs: 0 };
}

/**
 * Supplies controllable message completions and tracks mounted UI without invoking real React rendering.
 */
function fixture() {
  let current = session('first');
  const held = [];
  const roots = [];
  const timers = new Map();
  let sequence = 0;
  const document = {
    createElement: () => ({
      setAttribute() {},
      style: {},
      attachShadow: () => ({ append() {} }),
      remove() {},
    }),
    documentElement: { append() {} },
    querySelector: () => null,
    addEventListener() {},
  };
  const browser = {
    runtime: {
      sendMessage: (message) => {
        if (message.type === 'recorder.hello') {
          return Promise.resolve({ ok: true, value: { session: structuredClone(current), lastBatch: 0 } });
        }
        return new Promise((resolve, reject) => held.push({ message, resolve, reject }));
      },
    },
  };
  const module = { exports: {} };
  new Function(
    'require',
    'module',
    'exports',
    'document',
    'setTimeout',
    'clearTimeout',
    bundle.outputFiles[0].text
  )(
    (name) => {
      if (name === 'wxt/browser') {
        return { browser };
      }
      if (name === 'fixture-recording-ui') {
        return { RecordingToolbar: () => null };
      }
      if (name === 'react-dom/client') {
        return {
          createRoot: () => {
            const root = {
              unmounted: false,
              last: null,
              render(value) {
                root.last = value;
              },
              unmount() {
                root.unmounted = true;
              },
            };
            roots.push(root);
            return root;
          },
        };
      }
      return require(name);
    },
    module,
    module.exports,
    document,
    (callback) => {
      const id = ++sequence;
      timers.set(id, callback);
      return id;
    },
    (id) => timers.delete(id)
  );
  const content = new module.exports.RecordingContent();
  return {
    content,
    held,
    roots,
    timers,
    /**
     * Switches authoritative session through the real hello handler.
     */
    async replace(id) {
      current = session(id);
      await content.hello();
    },
  };
}

test('late stop success from a previous recording cannot unmount the new toolbar', async () => {
  const f = fixture();
  await f.content.hello();
  const old = f.roots[0].last.props.control('stop');
  const command = f.held.shift();
  await f.replace('second');
  const root = f.roots.at(-1);
  command.resolve({ ok: true, value: { ...session('first'), status: 'stopped' } });
  await old;
  assert.equal(root.unmounted, false);
  assert.equal(root.last.props.session.id, 'second');
  f.content.dispose();
});

test('late pause success cannot replace a newer recording snapshot', async () => {
  const f = fixture();
  await f.content.hello();
  const old = f.roots[0].last.props.control('pause');
  const command = f.held.shift();
  await f.replace('second');
  command.resolve({ ok: true, value: { ...session('first'), status: 'paused' } });
  await old;
  assert.equal(f.roots.at(-1).last.props.session.id, 'second');
  f.content.dispose();
});

test('late control failure cannot display an error in a replacement recording', async () => {
  const f = fixture();
  await f.content.hello();
  const old = f.roots[0].last.props.control('pause');
  const command = f.held.shift();
  await f.replace('second');
  command.reject(new Error('RECORDING_DELIVERY'));
  await old;
  assert.equal(f.roots.at(-1).last.props.error, '');
  f.content.dispose();
});

test('cleanup removes pending send timers', async () => {
  const f = fixture();
  await f.content.hello();
  f.content.dispose();
  assert.equal(f.timers.size, 0);
  assert.equal(f.roots[0].unmounted, true);
});

test('an old terminal notification rechecks authority instead of destroying the new session', async () => {
  const f = fixture();
  await f.replace('second');
  const root = f.roots.at(-1);
  await f.content.receive({ type: 'recorder.state', session: null });
  assert.equal(root.unmounted, false);
  assert.equal(root.last.props.session.id, 'second');
  f.content.dispose();
});

test('late frame-gap rejection does not pollute replacement recording UI', async () => {
  const f = fixture();
  await f.content.hello();
  f.content.reportGap('frame');
  const report = f.held.shift();
  await f.replace('second');
  report.reject(new Error('disconnected'));
  await Promise.resolve();
  assert.equal(f.roots.at(-1).last.props.error, '');
  f.content.dispose();
});

test('lost batch acknowledgement retries identical facts and clears them only after matching ACK', async () => {
  const f = fixture();
  await f.content.hello();
  const fact = { id: 'event-one', at: 1, action: 'click', label: '查询', url: 'https://fixture.test/' };
  f.content.enqueue(fact);
  const drain = f.content.receive({ type: 'recorder.flush', sessionId: 'first' });
  const original = f.held.shift();
  original.reject(new Error('worker response lost'));
  for (let index = 0; index < 10 && !f.held.length; index++) {
    await Promise.resolve();
  }
  const retry = f.held.shift();
  assert.ok(retry);
  assert.deepEqual(retry.message, original.message);
  retry.resolve({ ok: true, value: { batch: 1, session: session('first') } });
  assert.deepEqual(await drain, { flushed: true });
  assert.equal(f.content.events.length, 0);
  f.content.dispose();
});

test('old batch completion cannot consume replacement-session events', async () => {
  const f = fixture();
  await f.content.hello();
  f.content.enqueue({ id: 'old-event', at: 1, action: 'click', label: '旧操作', url: '' });
  const oldDrain = f.content.receive({ type: 'recorder.flush', sessionId: 'first' });
  const oldBatch = f.held.shift();
  await f.replace('second');
  f.content.enqueue({ id: 'new-event', at: 2, action: 'click', label: '新操作', url: '' });
  oldBatch.resolve({ ok: true, value: { batch: 1, session: session('first') } });
  await oldDrain;
  assert.equal(f.content.events.length, 1);
  assert.equal(f.content.events[0].id, 'new-event');
  f.content.dispose();
});
