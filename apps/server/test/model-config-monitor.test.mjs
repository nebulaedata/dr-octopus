/**
 * @author Codex
 * @description Verifies durable input fingerprints, default-only updates and retry after malformed external edits.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelConfigMonitor } from '../dist/modules/settings/model-config-monitor.js';
import { RuntimeConfigChanges } from '../dist/lib/runtime-config/runtime-config-changes.js';

test('model/auth changes stale instances, default changes only notify, and fingerprints survive Host restart', async () => {
  const agentDir = await mkdtemp(join(tmpdir(), 'octopus-config-monitor-'));
  const changes = new RuntimeConfigChanges();
  let notices = 0;
  const options = { agentDir, changes, refresh: async () => {}, notify: () => notices++, onError() {} };
  const monitor = new ModelConfigMonitor(options);
  try {
    const first = await monitor.refresh();
    await writeFile(
      join(agentDir, 'settings.json'),
      JSON.stringify({ defaultProvider: 'p', defaultModel: 'one' })
    );
    const defaults = await monitor.refresh();
    assert.notEqual(first, defaults);
    assert.equal(changes.current(), 0);
    await writeFile(
      join(agentDir, 'models.json'),
      JSON.stringify({ providers: { p: { baseUrl: 'http://localhost:1234' } } })
    );
    const models = await monitor.refresh();
    assert.equal(changes.current(), 1);
    assert.deepEqual(changes.since(0), ['/settings/model-providers']);
    const restarted = new ModelConfigMonitor({ ...options, changes: new RuntimeConfigChanges() });
    assert.equal(await restarted.refresh(), models);
    await restarted.close();
    await writeFile(join(agentDir, 'auth.json'), 'invalid');
    await assert.rejects(monitor.refresh());
    assert.equal(changes.current(), 1);
    await writeFile(
      join(agentDir, 'auth.json'),
      JSON.stringify({ p: { type: 'api_key', key: 'test-only' } })
    );
    await monitor.refresh();
    assert.equal(changes.current(), 2);
    assert.ok(notices >= 4);
  } finally {
    await monitor.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});

test('native atomic replacements publish configuration changes without periodic reads', async () => {
  const agentDir = await mkdtemp(join(tmpdir(), 'octopus-watch-'));
  const changes = new RuntimeConfigChanges();
  let reads = 0;
  const committed = Promise.withResolvers();
  const monitor = new ModelConfigMonitor({
    agentDir,
    changes,
    refresh: async () => {
      reads++;
    },
    notify() {},
    onError: (error) => committed.reject(error),
  });
  const unsubscribe = changes.subscribe(() => committed.resolve());
  try {
    await monitor.start();
    await writeFile(join(agentDir, 'replacement.tmp'), '{"providers":{"new":{}}}');
    await rename(join(agentDir, 'replacement.tmp'), join(agentDir, 'models.json'));
    let deadline;
    try {
      await Promise.race([
        committed.promise,
        new Promise((_, reject) => {
          deadline = setTimeout(() => reject(new Error('No file event')), 3000);
        }),
      ]);
    } finally {
      clearTimeout(deadline);
    }
    assert.equal(changes.current(), 1);
    const settledReads = reads;
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(reads, settledReads, 'idle monitoring must not refresh the catalog');
  } finally {
    unsubscribe();
    await monitor.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});
