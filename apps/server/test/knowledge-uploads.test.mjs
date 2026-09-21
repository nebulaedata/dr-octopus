/**
 * @author Codex
 * @description Real tus requests verify resumable knowledge uploads, nullable global scope and independent source ownership.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { createDatabase } from '../dist/db/client.js';
import { KnowledgeUploadStore } from '../dist/modules/knowledge/knowledge-upload-store.js';
import { registerKnowledgeUploads } from '../dist/modules/knowledge/knowledge-upload.controller.js';

test('knowledge tus preserves acknowledged offsets and enforces workspace ownership', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-knowledge-tus-'));
  const database = createDatabase(join(root, 'server.db'));
  let copies = 0;
  const store = new KnowledgeUploadStore(database, join(root, 'uploads'), {
    upload: async (_scope, bytes) => {
      copies++;
      assert.equal(bytes.toString(), 'original');
      return { sha256: createHash('sha256').update(bytes).digest('hex') };
    },
  });
  const server = Fastify();
  server.register(async (api) => registerKnowledgeUploads(api, store, { resolve: async () => ({}) }), {
    prefix: '/api',
  });
  t.after(async () => {
    await server.close();
    await store.close();
    database.sqlite.close();
    await rm(root, { recursive: true, force: true });
  });
  const address = await server.listen({ host: '127.0.0.1', port: 0 });
  const concurrentHeaders = {
    'Tus-Resumable': '1.0.0',
    'Upload-Length': '8',
    'Upload-Metadata': 'filename ' + Buffer.from('concurrent.md').toString('base64'),
    'Idempotency-Key': randomUUID(),
  };
  const duplicateCreates = await Promise.all(
    [0, 1].map(() =>
      fetch(address + '/api/knowledge/global/uploads/tus', { method: 'POST', headers: concurrentHeaders })
    )
  );
  for (const response of duplicateCreates) {
    assert.equal(response.status, 201, await response.text());
  }
  assert.equal(duplicateCreates[0].headers.get('location'), duplicateCreates[1].headers.get('location'));
  for (const base of ['/api/knowledge/global', '/api/workspaces/workspace-a/knowledge']) {
    const created = await fetch(address + base + '/uploads/tus', {
      method: 'POST',
      headers: {
        'Tus-Resumable': '1.0.0',
        'Upload-Length': '8',
        'Upload-Metadata': 'filename ' + Buffer.from('original.md').toString('base64'),
        'Idempotency-Key': randomUUID(),
      },
    });
    assert.equal(created.status, 201, await created.text());
    const location = created.headers.get('location');
    assert.ok(location?.startsWith(base));
    const part = await fetch(address + location, {
      method: 'PATCH',
      headers: {
        'Tus-Resumable': '1.0.0',
        'Upload-Offset': '0',
        'Content-Type': 'application/offset+octet-stream',
      },
      body: 'orig',
    });
    assert.equal(part.status, 204, await part.text());
    assert.equal(part.headers.get('upload-offset'), '4');
    const head = await fetch(address + location, { method: 'HEAD', headers: { 'Tus-Resumable': '1.0.0' } });
    assert.equal(head.headers.get('upload-offset'), '4');
    const conflict = await fetch(address + location, {
      method: 'PATCH',
      headers: {
        'Tus-Resumable': '1.0.0',
        'Upload-Offset': '0',
        'Content-Type': 'application/offset+octet-stream',
      },
      body: 'xxxx',
    });
    assert.equal(conflict.status, 409);
    const finish = await fetch(address + location, {
      method: 'PATCH',
      headers: {
        'Tus-Resumable': '1.0.0',
        'Upload-Offset': '4',
        'Content-Type': 'application/offset+octet-stream',
      },
      body: 'inal',
    });
    assert.equal(finish.status, 204, await finish.text());
    const result = await fetch(address + location + '/result');
    assert.equal(result.status, 200, await result.clone().text());
    assert.equal((await result.json()).sha256, createHash('sha256').update('original').digest('hex'));
    assert.equal((await fetch(address + location + '/result')).status, 200);
    if (base.includes('workspace-a')) {
      assert.equal(
        (await fetch(address + location.replace('workspace-a', 'workspace-b') + '/result')).status,
        404
      );
    }
  }
  assert.equal(copies, 2);
  assert.equal(database.sqlite.prepare('SELECT count(*) AS n FROM attachments').get().n, 0);
});
