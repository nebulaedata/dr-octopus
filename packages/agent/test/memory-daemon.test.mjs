/**
 * @author Codex
 * @description Verify global Memory singleton ownership, remote curation fences and explicit service lifecycle.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  createMemoryService,
  getMemoryServiceStatus,
  startMemoryService,
  stopMemoryService,
  restartMemoryService,
} from '../dist/extensions/memory/sdk/index.js';
import { registerMemoryEvents } from '../dist/extensions/memory/extension/events.js';

const execute = promisify(execFile);
/**
 * Always explicitly stop the isolated daemon before deleting its storage.
 */
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'memory-daemon-'));
  t.after(async () => {
    await stopMemoryService(root);
    await rm(root, { recursive: true, force: true });
  });
  return root;
}
/**
 * Build one durable user fact for remote mutation checks.
 */
function fact(id) {
  return {
    requestId: id,
    canonicalKey: id,
    topic: 'Tests',
    type: 'preference',
    indexText: id,
    bodyMd: 'Prefer Chinese',
    sources: [{ sessionId: 's', entryId: id, evidence: 'Prefer Chinese' }],
  };
}

test(
  'independent clients elect one daemon, survive client exit, and honor persistent stop/restart',
  { timeout: 60000 },
  async (t) => {
    const root = await fixture(t);
    assert.equal((await getMemoryServiceStatus(root)).state, 'absent');
    const sdk = new URL('../dist/extensions/memory/sdk/index.js', import.meta.url).href;
    const script = `import { startMemoryService } from ${JSON.stringify(sdk)}; console.log(JSON.stringify(await startMemoryService(${JSON.stringify(root)})));`;
    const starts = await Promise.all(
      Array.from({ length: 3 }, () =>
        execute(process.execPath, ['--input-type=module', '-e', script], {
          timeout: 45000,
          windowsHide: true,
        })
      )
    );
    const statuses = starts.map(({ stdout }) => JSON.parse(stdout));
    assert.equal(new Set(statuses.map((s) => s.daemonId)).size, 1);
    const client = createMemoryService({ dataRoot: root });
    t.after(() => client.dispose());
    const written = await client.remember(fact('persistent'));
    assert.equal(written.status, 'committed');
    assert.equal((await client.remember(fact('persistent'))).revision, written.revision);
    const endpoint = JSON.parse(await readFile(join(root, 'memory', 'endpoint.json'), 'utf8'));
    assert.equal((await fetch(`http://127.0.0.1:${endpoint.port}/memory/v1/status`)).status, 401);
    await client.dispose();
    assert.equal((await getMemoryServiceStatus(root)).state, 'running');
    const stopped = await stopMemoryService(root);
    assert.equal(stopped.autostartSuppressed, true);
    const later = createMemoryService({ dataRoot: root });
    t.after(() => later.dispose());
    await assert.rejects(later.initialize(), { code: 'MEMORY_SERVICE_STOPPED' });
    await assert.rejects(later.getStatus(), { code: 'MEMORY_SERVICE_STOPPED' });
    await startMemoryService(root);
    const before = await getMemoryServiceStatus(root);
    const after = await restartMemoryService(root);
    assert.notEqual(before.daemonId, after.daemonId);
    assert.equal((await later.getStatus()).count, 1);
    assert.equal((await later.getStatus()).storeId, written.ref.storeId);
  }
);

test(
  'remote curation retains atomic batches and rejects policy changes during local inference',
  { timeout: 60000 },
  async (t) => {
    const root = await fixture(t);
    const client = createMemoryService({ dataRoot: root });
    t.after(() => client.dispose());
    await client.initialize();
    const item = fact('curation');
    const signal = new AbortController().signal;
    const receipts = await client.evaluateRun(item.sources, async () => [item], signal);
    assert.equal(receipts.length, 1);
    assert.equal((await client.getStatus()).count, 1);
    const next = fact('stale');
    await assert.rejects(
      client.evaluateRun(
        next.sources,
        async () => {
          const status = await client.getStatus();
          await client.setPolicy({ mode: 'off', expectedRevision: status.revision, requestId: 'off' });
          return [next];
        },
        signal
      ),
      { code: 'CANCELLED' }
    );
    assert.equal((await client.getStatus()).count, 1);
  }
);

test('session_start returns before Memory initialization and shutdown ignores late status', async () => {
  const handlers = new Map();
  const statuses = [];
  let ready;
  const initialization = new Promise((resolve) => {
    ready = resolve;
  });
  registerMemoryEvents(
    { on: (name, fn) => handlers.set(name, fn) },
    { initialize: () => initialization, dispose: async () => {} },
    false
  );
  const result = handlers.get('session_start')({}, { ui: { setStatus: (...args) => statuses.push(args) } });
  assert.equal(result, undefined);
  await handlers.get('session_shutdown')();
  ready({ mode: 'auto' });
  await initialization;
  await Promise.resolve();
  assert.deepEqual(statuses, []);
});

test(
  'failed migration never publishes readiness and releases ownership for a repaired start',
  { timeout: 60000 },
  async (t) => {
    const root = await fixture(t);
    await assert.rejects(startMemoryService(root, 20000, true, undefined, join(root, 'missing-migrations')), {
      code: 'MEMORY_START_FAILED',
    });
    assert.notEqual((await getMemoryServiceStatus(root)).state, 'running');
    await assert.rejects(readFile(join(root, 'memory', 'endpoint.json')), { code: 'ENOENT' });
    assert.equal((await startMemoryService(root)).state, 'running');
  }
);

test('public Memory SDK imports and constructs without loading native database modules', async () => {
  const sdk = new URL('../dist/extensions/memory/sdk/index.js', import.meta.url).href;
  const script = `import { registerHooks } from 'node:module';
    registerHooks({ resolve(specifier, context, next) {
      if (specifier.includes('better-sqlite3') || specifier.startsWith('drizzle-orm')) throw new Error('Eager database import');
      return next(specifier, context);
    }});
    const {createMemoryService} = await import(${JSON.stringify(sdk)});
    await createMemoryService().dispose();`;
  await execute(process.execPath, ['--input-type=module', '-e', script], {
    timeout: 20000,
    windowsHide: true,
  });
});
