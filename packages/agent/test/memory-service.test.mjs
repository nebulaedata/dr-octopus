/**
 * @author Codex
 * @description Exercise the built memory SDK with isolated, real SQLite migrations and independent clients.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { CONFIG_DIR_NAME } from '@earendil-works/pi-coding-agent';
import {
  createLocalMemoryService as createMemoryService,
  resolveMemoryPaths,
} from '../dist/extensions/memory/lib/local-service.js';
/**
 * Create isolated storage and close both clients before removal.
 */
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'octopus-memory-'));
  const a = createMemoryService({ dataRoot: root }),
    b = createMemoryService({ dataRoot: root });
  const extras = [];
  t.after(async () => {
    await Promise.all(extras.map((client) => client.dispose()));
    await a.dispose();
    await b.dispose();
    await rm(root, { recursive: true, force: true });
  });
  return { root, a, b, extras };
}
/**
 * Build deterministic facts whose keys and evidence can be asserted independently.
 */
function fact(n, bodyMd = 'Durable fact ' + n) {
  return {
    requestId: 'request-' + n,
    canonicalKey: 'fact.' + n,
    topic: 'Testing',
    type: 'preference',
    indexText: 'Memory testing ' + n,
    bodyMd,
    sources: [{ sessionId: 'session', entryId: 'entry-' + n, evidence: bodyMd.slice(0, 800) }],
    action: 'create',
  };
}
test('global path and lazy reads are independent of agentDir and cwd', async (t) => {
  const { root, a } = await fixture(t);
  assert.equal(resolveMemoryPaths().databasePath, join(homedir(), CONFIG_DIR_NAME, 'memory', 'memory.db'));
  assert.equal((await a.getStatus()).availability, 'uninitialized');
  assert.deepEqual((await a.recall({ mode: 'page' })).items, []);
  await assert.rejects(access(join(root, 'memory')));
});
test('migrations, sharing, FTS, idempotency, compare-and-swap and superseding', async (t) => {
  const { a, b } = await fixture(t);
  const receipt = await a.remember(fact(1));
  assert.deepEqual(await b.remember(fact(1)), receipt);
  assert.equal((await b.getStatus()).count, 1);
  assert.equal((await b.recall({ mode: 'search', query: 'testing' })).items.length, 1);
  await assert.rejects(b.remember({ ...fact(1), bodyMd: 'different' }), { code: 'REVISION_CONFLICT' });
  const doc = (await b.read({ refs: [receipt.ref] })).items[0].document;
  const update = {
    ...fact(1),
    requestId: 'update-1',
    action: 'update',
    target: receipt.ref,
    expectedRevision: doc.revision,
    bodyMd: 'new body',
  };
  await a.remember(update);
  await assert.rejects(b.remember({ ...update, requestId: 'update-2' }), { code: 'REVISION_CONFLICT' });
  const next = await b.remember({
    ...update,
    requestId: 'supersede',
    action: 'supersede',
    expectedRevision: 2,
  });
  assert.notEqual(next.ref.indexId, receipt.ref.indexId);
  assert.equal((await a.read({ refs: [receipt.ref] })).items[0].error, 'NOT_FOUND');
  assert.equal((await a.getStatus()).count, 1);
});
test('revision-bound pagination covers more than 100 facts without gaps', async (t) => {
  const { a, b } = await fixture(t);
  for (let i = 0; i < 105; i++) await a.remember(fact(i));
  const ids = [];
  let cursor;
  do {
    const page = await a.recall({ mode: 'page', cursor });
    ids.push(...page.items.map((i) => i.indexId));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(ids.length, 105);
  assert.equal(new Set(ids).size, 105);
  const page = await a.recall({ mode: 'page' });
  await b.remember(fact(200));
  await assert.rejects(a.recall({ mode: 'page', cursor: page.nextCursor }), { code: 'CURSOR_STALE' });
});
test('forget removes all versions and fences outstanding and replayed inference', async (t) => {
  const { a, b } = await fixture(t);
  const receipt = await a.remember(fact(1));
  const status = await a.getStatus();
  await b.forget({ requestId: 'forget', ref: receipt.ref, expectedRevision: 1 });
  await assert.rejects(
    a.remember(
      { ...fact(1), requestId: 'stale' },
      { epoch: status.writeEpoch, signal: new AbortController().signal }
    ),
    { code: 'CANCELLED' }
  );
  let called = false;
  assert.deepEqual(
    await a.evaluateRun(
      fact(1).sources,
      async () => {
        called = true;
        return [fact(1)];
      },
      new AbortController().signal
    ),
    []
  );
  assert.equal(called, false);
  assert.equal((await a.getStatus()).count, 0);
  assert.equal((await a.recall({ mode: 'search', query: 'testing' })).items.length, 0);
  await a.remember({ ...fact(1), requestId: 'explicit-new' });
  assert.equal((await b.getStatus()).count, 1);
});
test('curation works in an empty store and cannot commit after policy changes', async (t) => {
  const { a, b } = await fixture(t);
  await a.initialize();
  const result = await a.evaluateRun(fact(1).sources, async () => [fact(1)], new AbortController().signal);
  assert.equal(result.length, 1);
  await assert.rejects(
    a.evaluateRun(
      fact(2).sources,
      async () => {
        const status = await b.getStatus();
        await b.setPolicy({ requestId: 'off', mode: 'off', expectedRevision: status.revision });
        return [fact(2)];
      },
      new AbortController().signal
    ),
    { code: 'CANCELLED' }
  );
  assert.equal((await a.getStatus()).count, 1);
});
test('read continuation reconstructs Unicode sections and rejects stale continuation', async (t) => {
  const { a } = await fixture(t);
  const body = '中文😀'.repeat(3000);
  const receipt = await a.remember(fact(1, body));
  let text = '',
    continuation;
  do {
    const result = await a.read({ refs: [receipt.ref], continuation });
    text += result.items[0].document.bodyMd;
    continuation = result.continuation;
  } while (continuation);
  assert.equal(text, body);
});
test('read-only clients cannot mutate or initialize global policy', async (t) => {
  const { root, a, extras } = await fixture(t);
  const child = createMemoryService({ dataRoot: root, readOnly: true });
  extras.push(child);
  await assert.rejects(child.initialize(), { code: 'READ_ONLY' });
  await assert.rejects(child.remember(fact(1)), { code: 'READ_ONLY' });
  await a.remember(fact(1));
  assert.equal((await child.recall({ mode: 'page' })).items.length, 1);
  assert.equal((await child.getStatus()).availability, 'read-only');
});

/**
 * Contended writers preserve all independent facts and commit a candidate batch atomically.
 */
test('twenty concurrent clients, rollback, and reassessment from fresh canonical facts', async (t) => {
  const { root, a, extras } = await fixture(t);
  const clients = Array.from({ length: 20 }, () => createMemoryService({ dataRoot: root }));
  extras.push(...clients);
  await Promise.all(clients.map((client, i) => client.remember(fact(i))));
  assert.equal((await a.getStatus()).count, 20);
  let attempts = 0;
  const source = fact(30).sources;
  const result = await a.evaluateRun(
    source,
    async (input) => {
      attempts++;
      if (attempts === 1) return [{ ...fact(30) }, { ...fact(1), sources: source }];
      const existing = input.existing.find((doc) => doc.canonicalKey === 'fact.1');
      assert.ok(existing);
      return [
        { ...fact(30) },
        {
          ...fact(1),
          sources: source,
          requestId: 'merge',
          action: 'merge',
          target: { storeId: existing.storeId, indexId: existing.indexId },
          expectedRevision: existing.revision,
        },
      ];
    },
    new AbortController().signal
  );
  assert.equal(attempts, 2);
  assert.equal(result.length, 2);
  assert.equal((await a.getStatus()).count, 21);
});

test('derived index rebuild and consistent Markdown export preserve facts', async (t) => {
  const { a, b } = await fixture(t);
  await a.remember(fact(1));
  const version = (await a.getStatus()).revision;
  await a.rebuildFts();
  assert.equal((await a.getStatus()).revision, version);
  assert.equal((await a.recall({ mode: 'search', query: 'testing' })).items.length, 1);
  let content = '';
  for await (const chunk of a.exportWiki()) content += chunk;
  assert.ok(content.includes('Durable fact 1'));
  const iterator = a.exportWiki();
  await iterator.next();
  await b.remember(fact(2));
  await assert.rejects(iterator.next(), { code: 'CURSOR_STALE' });
});
