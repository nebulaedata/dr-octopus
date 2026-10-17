/**
 * @author Codex
 * @description Exercises production Browser routing admission, document revisions and non-replaying recovery with deterministic browser API peers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/browser-router.ts', import.meta.url))],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
});
/**
 * Replaces only browser APIs while evaluating the actual router and shared contracts.
 */
function fixture() {
  let ready;
  let updated;
  let replaced;
  let controllerId = randomUUID();
  let revision;
  const state = {
    allowed: true,
    missing: false,
    revokeOnPing: false,
    actionFailure: false,
    unavailable: false,
    tab: {
      id: 1,
      url: 'http://fixture.test/',
      title: 'fixture',
      incognito: false,
      discarded: false,
      frozen: false,
    },
    pings: 0,
    injections: 0,
    actions: 0,
    removed: 0,
    released: [],
  };
  const browser = {
    runtime: {
      id: 'fixture',
      onMessage: {
        addListener: (listener) => {
          ready = listener;
        },
      },
    },
    permissions: { contains: async () => state.allowed },
    scripting: {
      executeScript: async (params) => {
        assert.equal(params.world, 'ISOLATED');
        assert.deepEqual(params.target.frameIds, [0]);
        state.injections++;
        state.missing = false;
      },
    },
    tabs: {
      onActivated: { addListener: () => {} },
      get: async () => {
        if (state.unavailable) {
          throw new Error('No tab with id: 1.');
        }
        return { ...state.tab };
      },
      query: async () => [state.tab],
      remove: async () => {
        state.removed++;
      },
      onRemoved: { addListener: () => {} },
      onReplaced: {
        addListener: (listener) => {
          replaced = listener;
        },
      },
      onUpdated: {
        addListener: (listener) => {
          updated = listener;
        },
      },
      sendMessage: async (_id, message, target) => {
        if (message.type === 'page.release') {
          assert.equal(target.documentId, 'document');
          state.released.push(message);
          return { released: true };
        }
        if (message.type === 'page.ping') {
          state.pings++;
          if (state.revokeOnPing) {
            state.allowed = false;
          }
          if (state.missing) {
            throw new Error('Could not establish connection. Receiving end does not exist.');
          }
          if (revision && revision !== message.documentRevision) {
            controllerId = randomUUID();
          }
          revision = message.documentRevision;
          const identity = await ready(
            { type: 'page.ready', controllerId },
            {
              id: 'fixture',
              frameId: 0,
              tab: { id: state.tab.id },
              documentId: 'document',
              url: state.tab.url,
            }
          );
          return { ...identity, controllerId };
        }
        assert.equal(target.documentId, 'document');
        state.actions++;
        if (state.actionFailure) {
          throw new Error('Receiving end does not exist.');
        }
        return { result: 'fixture' };
      },
    },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(
    (id) => (id === 'wxt/browser' ? { browser } : require(id)),
    module,
    module.exports
  );
  const router = new module.exports.BrowserRouter();
  const connectionId = randomUUID();
  /**
   * Constructs a finite command without exposing any script payload interface.
   */
  const command = (method, params = { tabId: 1, screenshot: false }) => ({
    type: 'request',
    requestId: randomUUID(),
    connectionId,
    taskId: '11111111-1111-4111-8111-111111111111',
    method,
    params,
  });
  return {
    router,
    state,
    command,
    identity: () => controllerId,
    navigate: () => updated(1, { url: state.tab.url }),
    replace: () => replaced(2, 1),
  };
}
test('discarded/frozen targets reject before probes or injection; closing and listing do not activate them', async () => {
  for (const field of ['discarded', 'frozen']) {
    const { router, state, command } = fixture();
    state.tab[field] = true;
    await assert.rejects(router.execute(command('browser_snapshot')), /TAB_NOT_EXECUTABLE/);
    assert.equal(state.pings, 0);
    assert.equal(state.injections, 0);
    assert.equal(state.actions, 0);
    assert.equal((await router.execute(command('browser_tabs', {}))).tabs.length, 1);
    await router.execute(command('browser_close_tab'));
    assert.equal(state.removed, 1);
  }
});

test('unavailable and replaced targets invalidate old handles before any action or repair injection', async () => {
  const missing = fixture();
  missing.state.unavailable = true;
  await assert.rejects(missing.router.execute(missing.command('browser_snapshot')), /TARGET_CHANGED/);
  assert.equal(missing.state.pings, 0);
  assert.equal(missing.state.injections, 0);
  assert.equal(missing.state.actions, 0);
  const peer = fixture();
  await peer.router.execute(peer.command('browser_snapshot'));
  const old = peer.identity();
  peer.replace();
  await assert.rejects(
    peer.router.execute(
      peer.command('browser_click', {
        tabId: 1,
        target: { documentId: 'document', controllerId: old, snapshotId: randomUUID(), elementIndex: 0 },
      })
    ),
    /TARGET_CHANGED/
  );
  assert.equal(peer.state.injections, 0);
  assert.equal(peer.state.actions, 1);
});
test('a missing receiver permits one fixed injection; permission loss during the probe forbids injection', async () => {
  const first = fixture();
  first.state.missing = true;
  await first.router.execute(first.command('browser_snapshot'));
  assert.equal(first.state.pings, 2);
  assert.equal(first.state.injections, 1);
  assert.equal(first.state.actions, 1);
  const revoked = fixture();
  revoked.state.missing = true;
  revoked.state.revokeOnPing = true;
  await assert.rejects(revoked.router.execute(revoked.command('browser_snapshot')), /FORBIDDEN_PAGE/);
  assert.equal(revoked.state.injections, 0);
  assert.equal(revoked.state.actions, 0);
});
test('URL update revisions invalidate old controller references even after the URL returns to its original value', async () => {
  const peer = fixture();
  await peer.router.execute(peer.command('browser_snapshot'));
  const old = peer.identity();
  peer.navigate();
  peer.navigate();
  await assert.rejects(
    peer.router.execute(
      peer.command('browser_click', {
        tabId: 1,
        target: { documentId: 'document', controllerId: old, snapshotId: randomUUID(), elementIndex: 0 },
      })
    ),
    /TARGET_CHANGED/
  );
  assert.equal(peer.state.actions, 1);
});
test('an action send failure is propagated without injection or automatic replay', async () => {
  const peer = fixture();
  await peer.router.execute(peer.command('browser_snapshot'));
  peer.state.actionFailure = true;
  await assert.rejects(
    peer.router.execute(
      peer.command('browser_click', {
        tabId: 1,
        target: {
          documentId: 'document',
          controllerId: peer.identity(),
          snapshotId: randomUUID(),
          elementIndex: 0,
        },
      })
    ),
    /Receiving end/
  );
  assert.equal(peer.state.injections, 0);
  assert.equal(peer.state.actions, 2);
});

test('task completion releases only its own document feedback; disconnect also releases and never closes tabs', async () => {
  const peer = fixture();
  const snapshot = peer.command('browser_snapshot');
  await peer.router.execute(snapshot);
  await peer.router.execute({
    type: 'release',
    requestId: randomUUID(),
    connectionId: randomUUID(),
    taskId: snapshot.taskId,
  });
  assert.equal(peer.state.released.length, 0);
  await peer.router.execute({
    type: 'release',
    requestId: randomUUID(),
    connectionId: snapshot.connectionId,
    taskId: snapshot.taskId,
  });
  assert.equal(peer.state.released.length, 1);
  assert.equal(peer.state.released[0].taskId, snapshot.taskId);
  await peer.router.execute(snapshot);
  peer.router.reset();
  assert.equal(peer.state.released.length, 2);
  assert.equal(peer.state.removed, 0);
});

test('completed tasks reclaim route capacity while their tabs stay open', async () => {
  const peer = fixture();
  for (let id = 1; id <= 40; id++) {
    peer.state.tab.id = id;
    const snapshot = {
      ...peer.command('browser_snapshot', { tabId: id, screenshot: false }),
      taskId: randomUUID(),
    };
    await peer.router.execute(snapshot);
    await peer.router.execute({
      type: 'release',
      requestId: randomUUID(),
      connectionId: snapshot.connectionId,
      taskId: snapshot.taskId,
    });
  }
  assert.equal(peer.state.actions, 40);
  assert.equal(peer.state.released.length, 40);
  assert.equal(peer.state.removed, 0);
});

test('foreign releases preserve active route limits until the owning task releases them', async () => {
  const peer = fixture();
  const owner = peer.command('browser_snapshot');
  for (let id = 1; id <= 32; id++) {
    peer.state.tab.id = id;
    await peer.router.execute(peer.command('browser_snapshot', { tabId: id, screenshot: false }));
  }
  for (const foreign of [
    { taskId: randomUUID(), connectionId: owner.connectionId },
    { taskId: owner.taskId, connectionId: randomUUID() },
  ]) {
    await peer.router.execute({ type: 'release', requestId: randomUUID(), ...foreign });
    peer.state.tab.id = 33;
    await assert.rejects(
      peer.router.execute(peer.command('browser_snapshot', { tabId: 33, screenshot: false })),
      /BROWSER_BUSY/
    );
  }
  assert.equal(peer.state.released.length, 0);
  await peer.router.execute({
    type: 'release',
    requestId: randomUUID(),
    taskId: owner.taskId,
    connectionId: owner.connectionId,
  });
  await peer.router.execute(peer.command('browser_snapshot', { tabId: 33, screenshot: false }));
  assert.equal(peer.state.actions, 33);
  assert.equal(peer.state.removed, 0);
});
