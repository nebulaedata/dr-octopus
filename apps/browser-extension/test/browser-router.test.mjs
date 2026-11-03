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
    idle: true,
    missing: false,
    revokeOnPing: false,
    actionFailure: false,
    unavailable: false,
    tab: {
      id: 1,
      windowId: 2,
      url: 'http://fixture.test/',
      title: 'fixture',
      incognito: false,
      discarded: false,
      frozen: false,
    },
    activated: [],
    navigations: 0,
    created: 0,
    windowUpdates: [],
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
    windows: {
      get: async () => ({ state: 'minimized' }),
      update: async (id, update) => {
        state.windowUpdates.push({ id, ...update });
      },
    },
    tabs: {
      create: async ({ url, windowId }) => {
        state.created++;
        state.tab = { ...state.tab, windowId, url: 'about:blank', pendingUrl: url, status: 'loading' };
        return { ...state.tab };
      },
      update: async (id, update) => {
        state.activated.push({ id, ...update });
        if (update.url) {
          state.navigations++;
          state.tab.url = update.url;
          state.tab.status = 'complete';
        }
      },
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
        if (message.type === 'page.release-if-idle') {
          return { released: state.idle };
        }
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

test('recovery feasibility: authorized navigation needs no content observation, but scope boundaries still apply', async () => {
  const { router, state, command } = fixture();
  const runId = randomUUID();
  await router.claimLocal(runId, ['http://fixture.test'], 2);
  const navigate = {
    ...command('browser_navigate', { tabId: 1, url: 'http://fixture.test/next' }),
    localRunId: runId,
    taskId: runId,
  };
  delete navigate.connectionId;
  const result = await router.executeLocal(navigate);
  assert.equal(result.code, 'NAVIGATION_COMPLETED');
  assert.equal(state.navigations, 1);
  assert.equal(state.actions, 0);
  await assert.rejects(
    router.executeLocal({ ...navigate, params: { tabId: 1, url: 'https://outside.test/' } }),
    /FORBIDDEN_PAGE/
  );
  assert.equal(state.navigations, 1);
  state.tab.url = 'https://outside.test/';
  await assert.rejects(router.executeLocal(navigate), /FORBIDDEN_PAGE/);
  assert.equal(state.navigations, 1);
  await router.releaseLocal(runId);
});

test('opening waits for a committed URL and verified receiver, reports its URL and never creates a duplicate tab', async () => {
  const { router, state, command } = fixture();
  const runId = randomUUID();
  await router.claimLocal(runId, ['http://fixture.test'], 2);
  const request = {
    ...command('browser_open_tab', { url: 'http://fixture.test/start', background: false }),
    taskId: runId,
    localRunId: runId,
  };
  delete request.connectionId;
  let settled = false;
  const pending = router.executeLocal(request).then((value) => {
    settled = true;
    return value;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(settled, false);
  assert.equal(state.pings, 0);
  state.tab.url = 'http://fixture.test/redirected';
  state.tab.status = 'complete';
  delete state.tab.pendingUrl;
  const result = await pending;
  assert.equal(result.url, 'http://fixture.test/redirected');
  assert.equal(state.created, 1);
  assert.ok(state.pings > 0);
  await router.releaseLocal(runId);
});

test('opening an eventually closed or out-of-scope page does not report readiness or reopen it', async () => {
  for (const failure of ['closed', 'redirect']) {
    const { router, state, command } = fixture();
    const runId = randomUUID();
    await router.claimLocal(runId, ['http://fixture.test'], 2);
    const request = {
      ...command('browser_open_tab', { url: 'http://fixture.test/start', background: false }),
      taskId: runId,
      localRunId: runId,
    };
    delete request.connectionId;
    const pending = router.executeLocal(request);
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (failure === 'closed') {
      state.unavailable = true;
    } else {
      state.tab.url = 'https://outside.test/';
      state.tab.status = 'complete';
      delete state.tab.pendingUrl;
    }
    const receipt = await pending;
    assert.equal(receipt.tabId, 1);
    assert.equal(receipt.businessEffect, 'applied');
    assert.equal(receipt.readiness.status, 'not_ready');
    assert.equal(receipt.readiness.code, failure === 'closed' ? 'TARGET_CHANGED' : 'FORBIDDEN_PAGE');
    assert.equal(state.created, 1);
    assert.equal(state.actions, 0);
  }
});

test('main document receiver can be ready while unrelated resources keep tab loading', async () => {
  const { router, state, command } = fixture();
  const runId = randomUUID();
  await router.claimLocal(runId, ['http://fixture.test'], 2);
  const request = {
    ...command('browser_open_tab', { url: 'http://fixture.test/start', background: false }),
    taskId: runId,
    localRunId: runId,
  };
  delete request.connectionId;
  const pending = router.executeLocal(request);
  await new Promise((resolve) => setTimeout(resolve, 20));
  state.tab.url = 'http://fixture.test/start';
  delete state.tab.pendingUrl;
  const receipt = await pending;
  assert.equal(state.tab.status, 'loading');
  assert.equal(receipt.tabId, 1);
  assert.equal(receipt.readiness, undefined);
  assert.equal(state.created, 1);
  assert.equal(state.injections, 0);
});

test('a page becoming ready in the second wait continues without reopening or waiting for the third timeout', async () => {
  const { router, state, command } = fixture();
  const runId = randomUUID();
  await router.claimLocal(runId, ['http://fixture.test'], 2, { seconds: 1, attempts: 3 });
  const request = {
    ...command('browser_open_tab', { url: 'http://fixture.test/start', background: false }),
    taskId: runId,
    localRunId: runId,
  };
  delete request.connectionId;
  state.missing = true;
  let settled = false;
  const waits = [];
  const pending = router
    .executeLocal(request, async (progress) => {
      waits.push(progress);
    })
    .then((result) => {
      settled = true;
      return result;
    });
  await new Promise((resolve) => setTimeout(resolve, 20));
  state.tab.url = 'http://fixture.test/start';
  delete state.tab.pendingUrl;
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal(settled, false);
  state.missing = false;
  const receipt = await pending;
  assert.equal(receipt.readiness, undefined);
  assert.equal(state.created, 1);
  assert.deepEqual(
    waits.map((progress) => progress.attempt),
    [1, 2]
  );
});

test(
  'missing static receiver times out as a known opened tab receipt without reinjection or duplicate creation',
  { timeout: 15000 },
  async () => {
    const { router, state, command } = fixture();
    const runId = randomUUID();
    await router.claimLocal(runId, ['http://fixture.test'], 2, { seconds: 1, attempts: 3 });
    const request = {
      ...command('browser_open_tab', { url: 'http://fixture.test/start', background: false }),
      taskId: runId,
      localRunId: runId,
    };
    delete request.connectionId;
    state.missing = true;
    const waits = [];
    const pending = router.executeLocal(request, async (progress) => {
      waits.push(progress);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    state.tab.url = 'http://fixture.test/start';
    delete state.tab.pendingUrl;
    const receipt = await pending;
    assert.equal(receipt.readiness.code, 'PAGE_READY_TIMEOUT');
    assert.deepEqual(receipt.readiness.wait, { waitSeconds: 1, timeouts: 3 });
    assert.equal(receipt.tabId, 1);
    assert.equal(state.created, 1);
    assert.equal(state.injections, 0);
    assert.deepEqual(
      waits.map((progress) => progress.attempt),
      [1, 2, 3]
    );
    assert.ok(
      waits.every((progress) => progress.tabId === 1 && progress.attempts === 3 && progress.seconds === 1)
    );
  }
);

test('recovery feasibility: inaccessible snapshots fail before PageController and permission restoration uses fresh observation', async () => {
  for (const reason of ['origin', 'window', 'scheme', 'permission', 'incognito']) {
    const { router, state, command } = fixture();
    const runId = randomUUID();
    await router.claimLocal(runId, ['http://fixture.test'], 2);
    const original = { ...state.tab };
    if (reason === 'origin') {
      state.tab.url = 'https://outside.test/';
    }
    if (reason === 'window') {
      state.tab.windowId = 3;
    }
    if (reason === 'scheme') {
      state.tab.url = 'chrome://settings';
    }
    if (reason === 'permission') {
      state.allowed = false;
    }
    if (reason === 'incognito') {
      state.tab.incognito = true;
    }
    const request = { ...command('browser_snapshot'), localRunId: runId, taskId: runId };
    delete request.connectionId;
    await assert.rejects(router.executeLocal(request), /FORBIDDEN_PAGE/);
    assert.equal(state.pings, 0, reason);
    assert.equal(state.actions, 0, reason);
    assert.deepEqual(await router.executeLocal({ ...request, method: 'browser_tabs', params: {} }), {
      tabs: [],
    });
    state.tab = original;
    state.allowed = true;
    await router.executeLocal(request);
    assert.equal(state.actions, 1);
    await router.releaseLocal(runId);
  }
});
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

test('local run identities cannot be cleared by Native disconnect or a matching Native UUID', async () => {
  const { router, state, command } = fixture();
  const runId = randomUUID();
  await router.claimLocal(runId, ['http://fixture.test']);
  const native = command('browser_snapshot');
  const { connectionId, ...request } = native;
  await router.executeLocal({ ...request, taskId: runId, localRunId: runId });
  await assert.rejects(router.execute(command('browser_snapshot')), /BROWSER_BUSY/);
  router.reset();
  await router.execute({ type: 'release', requestId: randomUUID(), connectionId: runId, taskId: runId });
  assert.equal(state.released.length, 0);
  assert.equal(router.busy(), true);
  await router.releaseLocal(runId);
  assert.equal(state.released.length, 1);
  assert.equal(state.released[0].localRunId, runId);
  assert.equal(Object.hasOwn(state.released[0], 'connectionId'), false);
  assert.equal(router.busy(), false);
  assert.ok(connectionId);
});

test('local acquisition honors recording admission and rejects pages outside its skill origins', async () => {
  const { router, state, command } = fixture();
  router.setRecordingAdmission(async () => {
    throw new Error('BROWSER_BUSY');
  });
  await assert.rejects(router.claimLocal(randomUUID(), ['http://fixture.test']), /BROWSER_BUSY/);
  assert.equal(router.busy(), false);
  router.setRecordingAdmission(async () => {});
  const runId = randomUUID();
  await router.claimLocal(runId, ['http://allowed.test']);
  const { connectionId, ...request } = command('browser_snapshot');
  await assert.rejects(
    router.executeLocal({ ...request, localRunId: runId, taskId: runId }),
    /FORBIDDEN_PAGE/
  );
  assert.equal(state.actions, 0);
  assert.ok(connectionId);
  await router.releaseLocal(runId);
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

test('restored uncertain ownership survives failed idle checks and failed durable acknowledgement', async () => {
  const { router, state, command } = fixture();
  const runId = randomUUID();
  router.restoreUncertainLocal(runId);
  await assert.rejects(router.execute(command('browser_tabs', {})), /BROWSER_BUSY/);
  await assert.rejects(router.claimLocal(randomUUID(), ['http://fixture.test']), /BROWSER_BUSY/);
  const documents = [{ tabId: 1, documentId: 'document' }];
  let committed = 0;
  state.idle = false;
  await assert.rejects(
    router.acknowledgeLocal(runId, documents, async () => {
      committed++;
    }),
    /BROWSER_BUSY/
  );
  assert.equal(committed, 0);
  state.idle = true;
  await assert.rejects(
    router.acknowledgeLocal(runId, documents, async () => {
      throw new Error('disk failure');
    }),
    /disk failure/
  );
  assert.equal(router.busy(), true);
  await assert.rejects(router.execute(command('browser_tabs', {})), /BROWSER_BUSY/);
  await router.acknowledgeLocal(runId, documents, async () => {
    committed++;
  });
  assert.equal(committed, 1);
  assert.equal(router.busy(), false);
  assert.equal((await router.execute(command('browser_tabs', {}))).tabs.length, 1);
  assert.equal(state.actions, 0);
});

test('local replay activates its real DOM-only target while native DOM-only reads remain passive', async () => {
  const native = fixture();
  await native.router.execute(native.command('browser_snapshot'));
  assert.deepEqual(native.state.activated, []);
  const local = fixture();
  const id = randomUUID();
  await local.router.claimLocal(id, ['http://fixture.test']);
  const request = local.command('browser_snapshot');
  delete request.connectionId;
  await local.router.executeLocal({ ...request, taskId: id, localRunId: id });
  assert.deepEqual(local.state.activated, [{ id: 1, active: true }]);
  assert.deepEqual(local.state.windowUpdates, [
    { id: 2, state: 'normal' },
    { id: 2, focused: true },
  ]);
  assert.equal(local.state.actions, 1);
  const blocked = fixture();
  blocked.state.allowed = false;
  await blocked.router.claimLocal(id, ['http://fixture.test']);
  await assert.rejects(
    blocked.router.executeLocal({ ...request, taskId: id, localRunId: id }),
    /FORBIDDEN_PAGE/
  );
  assert.deepEqual(blocked.state.activated, []);
});

test('panel replay excludes other windows before observing or mutating a target', async () => {
  const { router, state, command } = fixture();
  const runId = randomUUID();
  await router.claimLocal(runId, ['http://fixture.test'], 99);
  const { connectionId, ...request } = command('browser_snapshot');
  await assert.rejects(
    router.executeLocal({ ...request, localRunId: runId, taskId: runId }),
    /FORBIDDEN_PAGE/
  );
  assert.equal(state.pings, 0);
  assert.equal(state.actions, 0);
  assert.ok(connectionId);
  const tabs = await router.executeLocal({
    ...request,
    method: 'browser_tabs',
    params: {},
    localRunId: runId,
    taskId: runId,
  });
  assert.deepEqual(tabs, { tabs: [] });
  await router.claimLocal(runId, ['http://fixture.test'], 2);
  await router.executeLocal({ ...request, localRunId: runId, taskId: runId });
  assert.equal(state.actions, 1);
  await router.releaseLocal(runId);
});
