/**
 * @author Codex
 * @description Real-process knowledge lifecycle, read-only observation and persistent stop contracts.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, access, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import test from 'node:test';
import {
  startKnowledgeService,
  stopKnowledgeService,
  getKnowledgeServiceStatus,
  checkKnowledgeServiceHealth,
  createKnowledgeClient,
  withStoppedKnowledgeService,
} from '../dist/index.js';
import { tryAcquireProcessLock } from '../dist/lib/daemon-platform/singleton-lease.js';

test(
  'knowledge single owner, explicit stop suppression and identity-bound clients',
  { timeout: 90_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'octopus-knowledge-lifecycle-'));
    const directory = join(root, 'agent');
    t.after(async () => {
      await stopKnowledgeService(directory);
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });
    assert.equal((await getKnowledgeServiceStatus(directory)).state, 'absent');
    await assert.rejects(access(directory), { code: 'ENOENT' });
    const results = await Promise.all([startKnowledgeService(directory), startKnowledgeService(directory)]);
    assert.equal(results[0].daemonId, results[1].daemonId);
    await access(join(root, 'knowledge', 'control.sqlite'));
    await assert.rejects(access(join(directory, 'knowledge')), { code: 'ENOENT' });
    const siblingAgent = join(root, 'custom-agent');
    await mkdir(siblingAgent);
    assert.equal((await getKnowledgeServiceStatus(siblingAgent)).daemonId, results[0].daemonId);
    assert.equal((await checkKnowledgeServiceHealth(directory)).state, 'running');
    const modelClient = createKnowledgeClient({
      agentDir: directory,
      context: { principal: 'agent:test', globalWrite: true, modelAccess: 'invoke' },
    });
    await assert.rejects(modelClient.call('models.embed', { texts: ['probe'] }), {
      code: 'MODEL_NOT_CONFIGURED',
    });
    const client = createKnowledgeClient({
      agentDir: directory,
      context: { principal: 'test', globalWrite: true, modelAccess: 'none' },
    });
    const collection = await client.call('collections.create', {
      scope: { kind: 'global' },
      name: '单例验证',
    });
    assert.equal((await client.call('collections.list', {})).items[0].id, collection.id);
    await assert.rejects(
      withStoppedKnowledgeService(directory, async () => assert.fail('running backup')),
      { code: 'KNOWLEDGE_SERVICE_BUSY' }
    );
    assert.equal((await stopKnowledgeService(directory)).state, 'stopped');
    const restored = join(root, 'restored');
    await withStoppedKnowledgeService(directory, async (source) => {
      assert.equal(await tryAcquireProcessLock(join(source, 'daemon.lock')), null);
      await cp(source, join(restored, 'knowledge'), {
        recursive: true,
        filter: (path) => !['daemon.lock', 'endpoint.json', 'startup-error.json'].includes(basename(path)),
      });
    });
    try {
      await startKnowledgeService(join(restored, 'agent'));
      const restoredClient = createKnowledgeClient({
        agentDir: join(restored, 'agent'),
        context: { principal: 'test', globalWrite: false, modelAccess: 'none' },
      });
      assert.equal((await restoredClient.call('collections.list', {})).items[0].id, collection.id);
    } finally {
      await stopKnowledgeService(join(restored, 'agent'));
    }
    await assert.rejects(client.call('collections.list', {}), { code: 'KNOWLEDGE_SERVICE_STOPPED' });
    assert.equal((await startKnowledgeService(directory)).state, 'running');
    assert.equal((await client.call('collections.list', {})).items[0].id, collection.id);
  }
);
