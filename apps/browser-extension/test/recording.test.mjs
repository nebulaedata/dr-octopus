/**
 * @author Codex
 * @description Exercises production recording admission, atomic ACKs, drain ordering, privacy and recovery with deterministic peers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/recording/recording-service.ts', import.meta.url))],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
});

test('live tab scope rejects late batches before move/navigation notifications arrive', async () => {
  for (const change of [{ windowId: 8 }, { url: 'https://elsewhere.example.com/outside' }]) {
    const f = fixture();
    const session = await f.start();
    const sender = structuredClone(f.page());
    Object.assign(f.tabs.get(1), change);
    const reply = await f.send(
      { type: 'recorder.batch', sessionId: session.id, epoch: 1, batch: 1, events: [f.fact()] },
      sender
    );
    assert.equal(reply.ok, false);
    assert.equal(f.events.length, 0);
    assert.equal(f.sessions.get(session.id).pages[0].included, false);
  }
});

test('concurrent start commands reserve only one recording', async () => {
  const f = fixture();
  const results = await Promise.all(
    Array.from({ length: 20 }, () => f.send({ type: 'recorder.start', tabId: 1, includeRelated: false }))
  );
  assert.equal(results.filter((reply) => reply.ok).length, 1);
  assert.equal(results.filter((reply) => reply.error === 'RECORDING_BUSY').length, 19);
  assert.equal(f.sessions.size, 1);
});

test('batch checks scope again after waiting for the mutation queue', async () => {
  const f = fixture();
  const session = await f.start();
  const sender = structuredClone(f.page());
  let reads = 0;
  f.state.lookup = async () => {
    if (++reads === 2) {
      f.tabs.get(1).windowId = 8;
    }
  };
  const reply = await f.send(
    { type: 'recorder.batch', sessionId: session.id, epoch: 1, batch: 1, events: [f.fact()] },
    sender
  );
  assert.equal(reply.error, 'RECORDING_FORBIDDEN');
  assert.equal(f.events.length, 0);
});

test('Bridge acquiring ownership during tab lookup blocks capture before its reservation', async () => {
  const f = fixture();
  f.state.lookup = async () => {
    f.state.busy = true;
  };
  const reply = await f.send({ type: 'recorder.start', tabId: 1, includeRelated: false });
  assert.equal(reply.error, 'BROWSER_BUSY');
  assert.equal(f.sessions.size, 0);
});

test('replacement removes the old participant without silently enrolling a new tab', async () => {
  const f = fixture();
  const session = await f.start(true);
  await f.send({ type: 'recorder.hello' }, f.page(2, 'doc-2'));
  f.tabs.delete(1);
  f.service.observe(1, 'tab_close');
  await f.send({ type: 'recorder.status' });
  f.tabs.set(4, { id: 4, windowId: 7, url: 'https://orders.example.com/replacement', title: '替换页面' });
  assert.equal((await f.send({ type: 'recorder.hello' }, f.page(4, 'doc-4'))).value.session, null);
  const current = f.sessions.get(session.id);
  assert.equal(current.pages.find((page) => page.tabId === 1).included, false);
  assert.equal(current.pages.find((page) => page.tabId === 2).included, true);
  assert.equal(current.status, 'recording');
});

test('stop holds admission while flushing and deduplicates concurrent final deliveries', async () => {
  const f = fixture();
  const session = await f.start();
  f.state.flush = async () => {
    await assert.rejects(f.service.admitBridge('browser_snapshot'), /BROWSER_BUSY/);
    assert.equal(
      (await f.send({ type: 'recorder.start', tabId: 1, includeRelated: false })).error,
      'RECORDING_BUSY'
    );
    const batch = {
      type: 'recorder.batch',
      sessionId: session.id,
      epoch: 1,
      batch: 1,
      events: Array.from({ length: 100 }, () => f.fact()),
    };
    const replies = await Promise.all(Array.from({ length: 20 }, () => f.send(batch, f.page())));
    assert.ok(replies.every((reply) => reply.ok));
    return { flushed: true };
  };
  assert.equal((await f.send({ type: 'recorder.control', sessionId: session.id, action: 'stop' })).ok, true);
  assert.equal(f.events.length, 100);
  assert.equal(new Set(f.events.map((event) => event.id)).size, 100);
  await f.service.admitBridge('browser_snapshot');
});

test('revoked permission rejects a pending batch and removes capture membership', async () => {
  const f = fixture();
  const session = await f.start();
  f.state.allowed = false;
  const result = await f.send(
    { type: 'recorder.batch', sessionId: session.id, epoch: 1, batch: 1, events: [f.fact()] },
    f.page()
  );
  assert.equal(result.ok, false);
  assert.equal(f.events.length, 0);
  assert.equal(f.sessions.get(session.id).status, 'interrupted');
  assert.equal(f.sessions.get(session.id).pages[0].included, false);
  f.state.allowed = true;
  assert.equal((await f.send({ type: 'recorder.hello' }, f.page())).value.session, null);
});

test('related-tab browser fact commit preserves the newly bound document identity', async () => {
  const f = fixture();
  const session = await f.start(true);
  await f.send({ type: 'recorder.hello' }, f.page(2, 'doc-2'));
  assert.equal(f.sessions.get(session.id).pages[1].documentId, 'doc-2');
  const stopped = await f.send(
    { type: 'recorder.control', sessionId: session.id, action: 'stop' },
    f.page(2, 'doc-2')
  );
  assert.equal(stopped.ok, true);
});

test('restored document handshake resets its producer sequence without dropping later input', async () => {
  const f = fixture();
  const session = await f.start();
  const first = { type: 'recorder.batch', sessionId: session.id, epoch: 1, batch: 1, events: [f.fact()] };
  assert.equal((await f.send(first, f.page())).ok, true);
  assert.equal((await f.send({ type: 'recorder.hello' }, f.page())).value.lastBatch, 1);
  await f.send({ type: 'recorder.hello' }, f.page(1, 'doc-next'));
  const restored = await f.send({ type: 'recorder.hello' }, f.page());
  assert.equal(restored.value.lastBatch, 0);
  assert.equal((await f.send({ ...first, events: [f.fact()] }, f.page())).ok, true);
  assert.equal(f.events.length, 2);
});

test(
  'unresponsive flush seals a partial result within the existing stop deadline',
  { timeout: 6000 },
  async () => {
    const f = fixture();
    const session = await f.start();
    f.state.flush = () => new Promise(() => {});
    const result = await f.send({ type: 'recorder.control', sessionId: session.id, action: 'stop' });
    assert.equal(result.ok, true);
    assert.equal(result.value.status, 'stopped');
    assert.ok(result.value.gaps.some((gap) => gap.includes('最后批次')));
    assert.equal(
      (
        await f.send(
          { type: 'recorder.batch', sessionId: session.id, epoch: 1, batch: 1, events: [f.fact()] },
          f.page()
        )
      ).ok,
      false
    );
  }
);

test('revoking one participant preserves other pages and prevents batches from the removed page', async () => {
  const f = fixture();
  const session = await f.start(true);
  await f.send({ type: 'recorder.hello' }, f.page(2, 'doc-2'));
  f.tabs.get(2).discarded = true;
  await f.service.revalidate();
  assert.equal(f.sessions.get(session.id).status, 'recording');
  assert.equal(f.sessions.get(session.id).pages[0].included, true);
  assert.equal(f.sessions.get(session.id).pages[1].included, false);
  assert.equal(
    (
      await f.send(
        { type: 'recorder.batch', sessionId: session.id, epoch: 1, batch: 1, events: [f.fact()] },
        f.page(2, 'doc-2')
      )
    ).ok,
    false
  );
});

test('a frozen participating page is excluded without silently rejoining after thaw', async () => {
  const f = fixture();
  const session = await f.start();
  f.tabs.get(1).frozen = true;
  await f.service.revalidate();
  assert.equal(f.sessions.get(session.id).status, 'interrupted');
  f.tabs.get(1).frozen = false;
  assert.equal((await f.send({ type: 'recorder.hello' }, f.page())).value.session, null);
});

test('a failed initial drain write releases its mutex so a later stop can save evidence', async () => {
  const f = fixture();
  const session = await f.start();
  f.state.fail = true;
  assert.equal(
    (await f.send({ type: 'recorder.control', sessionId: session.id, action: 'stop' })).error,
    'RECORDING_STORAGE'
  );
  f.state.fail = false;
  const stopped = await f.send({ type: 'recorder.control', sessionId: session.id, action: 'stop' });
  assert.equal(stopped.ok, true);
  assert.equal(stopped.value.status, 'stopped');
  await f.service.admitBridge('browser_click');
});

test('tab closure during stop does not delete the session before its drain completes', async () => {
  const f = fixture();
  const session = await f.start();
  f.state.flush = async () => {
    f.service.observe(1, 'tab_close');
    await f.send({ type: 'recorder.status' });
    return { flushed: false };
  };
  const stopped = await f.send({ type: 'recorder.control', sessionId: session.id, action: 'stop' });
  assert.equal(stopped.ok, true);
  assert.equal(stopped.value.status, 'stopped');
  assert.ok(stopped.value.gaps.length);
});

test('browser event commits obey the global byte budget without changing committed event count', async () => {
  const seed = fixture();
  const session = await seed.start();
  const other = { ...session, id: randomUUID(), status: 'stopped', bytes: 100 * 1024 * 1024 };
  const f = fixture([session, other], { recordingSessionId: session.id });
  f.service.observe(1, 'tab_activate');
  await f.send({ type: 'recorder.status' });
  assert.equal(f.events.length, 0);
  assert.equal(f.sessions.get(session.id).count, 0);
  assert.equal(f.sessions.get(session.id).status, 'paused');
});

test('DOM event count and bytes enforce the configured ceiling before ACK', async () => {
  const seed = fixture();
  const original = await seed.start();
  for (const patch of [{ count: 20000 }, { bytes: 20 * 1024 * 1024 }]) {
    const session = { ...seed.sessions.get(original.id), ...patch };
    const f = fixture([session], { recordingSessionId: session.id });
    const reply = await f.send(
      { type: 'recorder.batch', sessionId: session.id, epoch: 1, batch: 1, events: [f.fact()] },
      f.page()
    );
    assert.equal(reply.error, 'RECORDING_LIMIT');
    assert.equal(f.events.length, 0);
    assert.equal(f.sessions.get(session.id).pages[0].lastBatch, 0);
  }
});

test('failed browser event transaction does not advance count or recent-event evidence', async () => {
  const f = fixture();
  const session = await f.start();
  f.state.fail = true;
  f.service.observe(1, 'tab_activate');
  await f.send({ type: 'recorder.status' });
  assert.equal(f.sessions.get(session.id).count, 0);
  assert.equal(f.events.length, 0);
  f.state.fail = false;
  const result = await f.send({ type: 'recorder.control', sessionId: session.id, action: 'stop' });
  assert.equal(result.ok, true);
  assert.equal(result.value.count, 0);
});
const privacyBundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/recording/recording-privacy.ts', import.meta.url))],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
});

/**
 * Provides transaction-like cloned writes and independently ordered browser replies.
 */
function fixture(saved = [], marker = {}) {
  const sessions = new Map(saved.map((item) => [item.id, structuredClone(item)]));
  const events = [];
  const tabs = new Map([
    [1, { id: 1, windowId: 7, url: 'https://orders.example.com/orders', title: '订单列表' }],
    [2, { id: 2, windowId: 7, openerTabId: 1, url: 'https://orders.example.com/detail', title: '订单详情' }],
    [3, { id: 3, windowId: 7, url: 'https://elsewhere.example.com/', title: '其他页面' }],
  ]);
  const state = {
    busy: false,
    allowed: true,
    fail: false,
    flush: async () => ({ flushed: true }),
    injected: 0,
    missing: false,
    lookup: async () => {},
  };
  const repository = {
    list: async () => [...sessions.values()].map((item) => structuredClone(item)),
    /**
     * Supplies the new terminal-summary repository boundary to worker protocol tests.
     */
    page: async (query = '', cursor = null, limit = 20) => ({
      items: [...sessions.values()]
        .filter(
          (item) =>
            (!cursor || item.startedAt < cursor.before[0]) &&
            ['stopped', 'interrupted'].includes(item.status) &&
            item.name.includes(query)
        )
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(0, limit)
        .map((item) => ({
          id: item.id,
          name: item.name,
          status: item.status,
          startedAt: item.startedAt,
          actionCount: item.actionCount,
          gapCount: item.gaps.length,
        })),
      nextCursor: null,
    }),
    get: async (id) => structuredClone(sessions.get(id)),
    events: async (id, after = 0) =>
      structuredClone(events.filter((item) => item.sessionId === id && item.seq > after).slice(0, 50)),
    /**
     * Fails before committing both pieces, mirroring an aborted IndexedDB transaction.
     */
    async save(session, batch = [], updates = []) {
      if (state.fail) {
        throw new Error('RECORDING_STORAGE');
      }
      sessions.set(session.id, structuredClone(session));
      for (const update of updates) {
        const index = events.findIndex((item) => item.id === update.id);
        if (index >= 0) {
          events[index] = structuredClone(update);
        }
      }
      events.push(...structuredClone(batch));
    },
    delete: async (id) => sessions.delete(id),
    prune: async () => {},
  };
  const browser = {
    runtime: { id: 'owned', getURL: (path) => `chrome-extension://owned${path}` },
    permissions: { contains: async () => state.allowed },
    storage: {
      session: {
        get: async () => ({ ...marker }),
        set: async (next) => Object.assign(marker, next),
        remove: async (key) => {
          delete marker[key];
        },
      },
      local: { set: async () => {} },
    },
    tabs: {
      get: async (id) => {
        await state.lookup();
        if (!tabs.has(id)) {
          throw new Error('missing');
        }
        return tabs.get(id);
      },
      query: async () => [tabs.get(1)],
      /**
       * Allows a final event batch to arrive while the stop command awaits this reply.
       */
      async sendMessage(_id, message) {
        if (message.type === 'recorder.flush') {
          return state.flush();
        }
        if (message.type === 'recorder.probe' && state.missing) {
          throw new Error('Receiving end does not exist');
        }
        return { ready: true };
      },
    },
    scripting: {
      executeScript: async () => {
        state.injected++;
      },
    },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(
    (name) => (name === 'wxt/browser' ? { browser } : require(name)),
    module,
    module.exports
  );
  const service = new module.exports.RecordingService(() => state.busy, repository);
  const popup = { id: 'owned', url: browser.runtime.getURL('/popup.html') };
  /**
   * Supplies browser-owned document identity, distinct from request payload fields.
   */
  const page = (id = 1, documentId = 'doc-1') => ({
    id: 'owned',
    url: tabs.get(id).url,
    frameId: 0,
    documentId,
    tab: tabs.get(id),
  });
  /**
   * Sends a real private protocol message through production sender checks.
   */
  const send = (message, sender = popup) => service.receive(message, sender);
  /**
   * Starts capture and establishes the top document's producer identity.
   */
  async function start(includeRelated = false) {
    const result = await send({ type: 'recorder.start', tabId: 1, includeRelated });
    assert.equal(result.ok, true);
    await send({ type: 'recorder.hello' }, page());
    return result.value;
  }
  /**
   * Creates a bounded semantic event without input values.
   */
  const fact = () => ({
    id: randomUUID(),
    at: 100,
    action: 'input',
    label: '订单号',
    url: 'https://orders.example.com/orders?token=SECRET',
    redacted: true,
  });
  return { service, state, sessions, events, tabs, marker, send, page, start, fact };
}

test('recording survives bridge absence and rejects foreign/page management commands', async () => {
  const f = fixture();
  assert.equal(f.send({ type: 'recorder.status' }, { id: 'foreign' }), undefined);
  assert.equal(
    (await f.send({ type: 'recorder.start', tabId: 1, includeRelated: false }, f.page())).ok,
    false
  );
  const session = await f.start();
  assert.equal(session.status, 'recording');
  assert.equal(f.marker.recordingSessionId, session.id);
  await assert.rejects(f.service.admitBridge('browser_snapshot'), /BROWSER_BUSY/);
  await f.service.admitBridge('browser_tabs');
  assert.equal(
    (await f.send({ type: 'recorder.control', sessionId: session.id, action: 'stop' }, f.page(3))).ok,
    false
  );
});

test('atomic batch ACK is idempotent and binds document, epoch and source URL', async () => {
  const f = fixture();
  const session = await f.start();
  const batch = { type: 'recorder.batch', sessionId: session.id, epoch: 1, batch: 1, events: [f.fact()] };
  assert.equal((await f.send(batch, f.page(1, 'stale-doc'))).ok, false);
  assert.equal((await f.send({ ...batch, epoch: 99 }, f.page())).ok, false);
  assert.equal((await f.send(batch, f.page())).ok, true);
  assert.equal((await f.send(batch, f.page())).ok, true);
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].url, 'https://orders.example.com/orders');
  assert.equal(f.sessions.get(session.id).count, 1);
  assert.equal((await f.send({ ...batch, batch: 3 }, f.page())).ok, false);
});

test('failed persistence never ACKs or increments committed producer progress', async () => {
  const f = fixture();
  const session = await f.start();
  f.state.fail = true;
  const result = await f.send(
    { type: 'recorder.batch', sessionId: session.id, epoch: 1, batch: 1, events: [f.fact()] },
    f.page()
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, 'RECORDING_STORAGE');
  assert.equal(f.events.length, 0);
  assert.equal(f.sessions.get(session.id).pages[0].lastBatch, 0);
});

test('stop admits the final batch without deadlock then rejects late deliveries', async () => {
  const f = fixture();
  const session = await f.start();
  const batch = { type: 'recorder.batch', sessionId: session.id, epoch: 1, batch: 1, events: [f.fact()] };
  f.state.flush = async () => {
    assert.equal((await f.send(batch, f.page())).ok, true);
    return { flushed: true };
  };
  const result = await f.send({ type: 'recorder.control', sessionId: session.id, action: 'stop' });
  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'stopped');
  assert.equal(result.value.count, 1);
  assert.equal((await f.send(batch, f.page())).ok, false);
  await f.service.admitBridge('browser_click');
});

test('pause seals an epoch; resume does not accept pre-pause input', async () => {
  const f = fixture();
  const session = await f.start();
  await f.send({ type: 'recorder.control', sessionId: session.id, action: 'pause' });
  const result = await f.send({ type: 'recorder.control', sessionId: session.id, action: 'resume' });
  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'recording');
  assert.equal(
    (
      await f.send(
        { type: 'recorder.batch', sessionId: session.id, epoch: 1, batch: 1, events: [f.fact()] },
        f.page()
      )
    ).ok,
    false
  );
});

test('only opted-in opener-related pages join automatically; unrelated pages need explicit consent', async () => {
  const f = fixture();
  const session = await f.start(true);
  assert.equal((await f.send({ type: 'recorder.hello' }, f.page(2, 'doc-2'))).value.session.pages.length, 2);
  assert.equal((await f.send({ type: 'recorder.hello' }, f.page(3, 'doc-3'))).value.session, null);
  assert.equal((await f.send({ type: 'recorder.include', sessionId: session.id, tabId: 3 })).ok, true);
  assert.equal((await f.send({ type: 'recorder.hello' }, f.page(3, 'doc-3'))).value.session.pages.length, 3);
});

test('browser restart interrupts persisted capture; worker restart preserves same-session recording', async () => {
  const first = fixture();
  const session = await first.start();
  const saved = [...first.sessions.values()];
  const restarted = fixture(saved);
  const view = await restarted.send({ type: 'recorder.status' });
  assert.equal(view.value.active, null);
  assert.equal(view.value.recent[0].status, 'interrupted');
  const worker = fixture(saved, { recordingSessionId: session.id });
  assert.equal((await worker.send({ type: 'recorder.status' })).value.active.id, session.id);
});

test('in-flight Bridge ownership blocks recording before page injection', async () => {
  const f = fixture();
  f.state.busy = true;
  f.state.missing = true;
  assert.equal(
    (await f.send({ type: 'recorder.start', tabId: 1, includeRelated: false })).error,
    'BROWSER_BUSY'
  );
  assert.equal(f.state.injected, 0);
});

test('privacy projection drops credentials, query, fragment and dynamic path identifiers', () => {
  const module = { exports: {} };
  new Function('module', 'exports', privacyBundle.outputFiles[0].text)(module, module.exports);
  assert.equal(
    module.exports.safeRecordingUrl('https://user:secret@example.com/orders/123456?token=SECRET#password'),
    'https://example.com/orders/:value'
  );
  assert.equal(module.exports.safeRecordingUrl('chrome://settings'), '');
  assert.ok(
    !module.exports.safeRecordingText('mail person@example.com phone 13812345678').includes('person@')
  );
});
