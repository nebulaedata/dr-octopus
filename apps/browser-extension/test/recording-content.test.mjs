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
  let lastBatch = 0;
  let deferHello = false;
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
          if (deferHello) {
            return new Promise((resolve, reject) => held.push({ message, resolve, reject }));
          }
          return Promise.resolve({ ok: true, value: { session: structuredClone(current), lastBatch } });
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
     * Holds the next authority reads to test the pre-capture handshake boundary.
     */
    deferHello() {
      deferHello = true;
    },
    /**
     * Delivers a Worker broadcast while hello supplies this document's committed cursor.
     */
    async broadcast(value, cursor = lastBatch) {
      current = value;
      lastBatch = cursor;
      await content.receive({ type: 'recorder.state', session: structuredClone(value) });
      await Promise.resolve();
    },
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

test('Popup resume clears recoverable capture errors only after authoritative cursor sync', async () => {
  for (const error of ['delivery', 'overflow']) {
    const f = fixture();
    await f.content.hello();
    f.content.error = error;
    f.content.held = true;
    await f.broadcast({ ...session('first'), status: 'paused', epoch: 2, updatedAt: 2 });
    assert.equal(f.content.error, error);
    await f.broadcast({ ...session('first'), epoch: 3, updatedAt: 3 }, 1);
    assert.equal(f.content.error, '');
    assert.equal(f.content.held, false);
    assert.equal(f.content.batch, 1);
    assert.ok(f.content.recorder.abort, 'DOM capture listeners restarted');
    f.content.dispose();
  }
});

test('resume after a lost committed ACK uses the next batch and fences old completion', async () => {
  const f = fixture();
  await f.content.hello();
  f.content.enqueue({ id: 'old', at: 1, action: 'click', label: 'old', url: '' });
  const oldDrain = f.content.receive({ type: 'recorder.flush', sessionId: 'first' });
  const oldBatch = f.held.shift();
  // Worker committed batch 1, but its reply has not reached Content before pause seals the epoch.
  await f.broadcast({ ...session('first'), epoch: 2, updatedAt: 2, status: 'paused' }, 1);
  await f.broadcast({ ...session('first'), epoch: 3, updatedAt: 3 }, 1);
  f.content.enqueue({ id: 'new', at: 3, action: 'click', label: 'new', url: '' });
  const newDrain = f.content.receive({ type: 'recorder.flush', sessionId: 'first' });
  const newBatch = f.held.shift();
  assert.equal(newBatch.message.batch, 2);
  assert.equal(newBatch.message.epoch, 3);
  assert.equal(newBatch.message.events[0].id, 'new');
  oldBatch.resolve({ ok: true, value: { batch: 1, session: session('first') } });
  await oldDrain;
  assert.equal(f.content.events[0].id, 'new');
  assert.ok(f.content.pending, 'old completion cannot clear the new send');
  newBatch.resolve({ ok: true, value: { batch: 2, session: { ...session('first'), epoch: 3 } } });
  assert.deepEqual(await newDrain, { flushed: true });
  assert.equal(f.content.events.length, 0);
  f.content.dispose();
});

test('resume keeps capture stopped until the document cursor handshake completes', async () => {
  const f = fixture();
  await f.content.hello();
  await f.broadcast({ ...session('first'), epoch: 2, updatedAt: 2, status: 'paused' });
  f.deferHello();
  const resumed = { ...session('first'), epoch: 3, updatedAt: 3 };
  await f.broadcast(resumed, 7);
  assert.equal(f.content.held, true);
  assert.equal(f.content.recorder.abort, undefined);
  const hello = f.held.shift();
  assert.equal(hello.message.type, 'recorder.hello');
  hello.resolve({ ok: true, value: { session: resumed, lastBatch: 7 } });
  await Promise.resolve();
  assert.equal(f.content.batch, 7);
  assert.equal(f.content.held, false);
  assert.ok(f.content.recorder.abort);
  f.content.dispose();
});
