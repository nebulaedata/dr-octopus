/**
 * @author Codex
 * @description Verifies real daemon push subscriptions, observe-only startup and read-without-refresh-loop semantics.
 */
import { subscribeDaemonChanges } from '../dist/lib/daemon-platform/change-subscription.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  createMemoryService,
  subscribeMemoryChanges,
  startMemoryService,
  stopMemoryService,
  restartMemoryService,
} from '../dist/extensions/memory/sdk/index.js';
import {
  createKnowledgeClient,
  subscribeKnowledgeChanges,
  startKnowledgeService,
  stopKnowledgeService,
} from '../dist/extensions/knowledge/sdk/index.js';

/** Waits for a notification-driven observation with a test-only failure deadline. */
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('No daemon change notification')), 10000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

for (const kind of ['memory', 'knowledge']) {
  test(
    `${kind} emits changes after mutations, keeps reads quiet and observes startup without creating storage`,
    { timeout: 60000 },
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'octopus-push-'));
      const agentDir = join(root, 'agent');
      await mkdir(agentDir);
      const client =
        kind === 'memory'
          ? createMemoryService({ dataRoot: root })
          : createKnowledgeClient({
              agentDir,
              autostart: false,
              context: { principal: 'test', globalWrite: true, modelAccess: 'none' },
            });
      let observe = () => Promise.resolve();
      let count = 0;
      const reads = new Set();
      const errors = [];
      const changed = () => {
        count++;
        const task = observe().catch(() => {});
        reads.add(task);
        void task.finally(() => reads.delete(task));
      };
      const subscription =
        kind === 'memory'
          ? await subscribeMemoryChanges(root, changed, (error) => errors.push(error))
          : await subscribeKnowledgeChanges(agentDir, changed, (error) => errors.push(error));
      const stop = () => (kind === 'memory' ? stopMemoryService(root) : stopKnowledgeService(agentDir));
      try {
        await assert.rejects(access(join(root, kind)), { code: 'ENOENT' });
        const ready = Promise.withResolvers();
        observe = async () => {
          if (kind === 'memory') await client.getStatus();
          else await client.call('collections.list', { scope: { kind: 'global' }, page: 1, pageSize: 20 });
          ready.resolve();
        };
        if (kind === 'memory') await startMemoryService(root);
        else await startKnowledgeService(agentDir);
        await bounded(ready.promise);
        await delay(200);
        const beforeRead = count;
        await observe();
        await delay(200);
        assert.equal(count, beforeRead, 'reads must not trigger an invalidation feedback loop');
        const committed = Promise.withResolvers();
        if (kind === 'memory') {
          const current = await client.getStatus();
          observe = async () => {
            const status = await client.getStatus();
            if (status.mode === 'off') committed.resolve();
          };
          await client.setPolicy({ requestId: 'policy', expectedRevision: current.revision, mode: 'off' });
        } else {
          observe = async () => {
            const page = await client.call('collections.list', {
              scope: { kind: 'global' },
              page: 1,
              pageSize: 20,
            });
            if (page.items.some((item) => item.name === 'Pushed')) committed.resolve();
          };
          await client.call('collections.create', { scope: { kind: 'global' }, name: 'Pushed' });
        }
        await bounded(committed.promise);
        assert.ok(count > beforeRead);
        if (kind === 'memory') {
          const reconnected = Promise.withResolvers();
          observe = async () => {
            await client.getStatus();
            reconnected.resolve();
          };
          await restartMemoryService(root);
          await bounded(reconnected.promise);
        }
      } finally {
        observe = () => Promise.resolve();
        await Promise.all([subscription.close(), subscription.close()]);
        await Promise.allSettled(reads);
        if ('dispose' in client) await client.dispose();
        await stop();
        await rm(root, { recursive: true, force: true });
      }
    }
  );
}

test('failed transport reconnects do not repeatedly invalidate business snapshots', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-stream-retry-'));
  let attempts = 0;
  let invalidations = 0;
  const retried = Promise.withResolvers();
  const subscription = await subscribeDaemonChanges({
    directory,
    connect: async () => {
      if (++attempts === 2) retried.resolve();
      throw new Error('offline');
    },
    onChange: () => invalidations++,
    onError() {},
  });
  try {
    await bounded(retried.promise);
    assert.equal(invalidations, 0);
  } finally {
    await subscription.close();
    await rm(directory, { recursive: true, force: true });
  }
});
