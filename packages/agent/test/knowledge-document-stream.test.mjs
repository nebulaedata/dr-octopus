/**
 * @author Codex
 * @description Verifies the knowledge parser's file inputs, acknowledged section delivery and scratch cleanup.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { KnowledgeBlobStore } from '../dist/extensions/knowledge/lib/blob-store.js';
import { runDocumentWorker } from '../dist/extensions/knowledge/lib/document-worker.js';

test('knowledge worker awaits section consumption and returns only counts to streaming callers', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-knowledge-stream-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new KnowledgeBlobStore(directory);
  const blob = await store.put(Buffer.from('第一段\n\n第二段\n\n第三段'));
  const work = {
    kind: 'parse',
    directory,
    source: { title: 'text.md', format: 'md', blobSha256: blob.sha256 },
    ocr: null,
  };
  let active = 0;
  const received = [];
  const result = await runDocumentWorker(work, undefined, async (section) => {
    assert.equal(active++, 0);
    await new Promise((resolve) => setTimeout(resolve, 10));
    received.push(section.text);
    active--;
  });
  assert.deepEqual(result, { sectionCount: 3 });
  assert.deepEqual(received, ['第一段', '第二段', '第三段']);
  assert.deepEqual(await readdir(directory), ['blobs']);
  await assert.rejects(
    runDocumentWorker(work, undefined, async () => {
      throw new Error('consumer failed');
    }),
    /consumer failed/u
  );
  assert.deepEqual(await readdir(directory), ['blobs']);
  const controller = new AbortController();
  await assert.rejects(
    runDocumentWorker(work, controller.signal, async () => {
      controller.abort();
    }),
    { code: 'JOB_CANCELLED' }
  );
  assert.deepEqual(await readdir(directory), ['blobs']);
});
