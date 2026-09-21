/**
 * @author Codex
 * @description Two real isolated daemons verify standard MCP mounting, publication isolation and token revocation.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import Fastify from 'fastify';
import { createKnowledgeClient, startKnowledgeService, stopKnowledgeService } from '@octopus/agent';
import { registerKnowledgeMcpController } from '../dist/modules/knowledge/knowledge-mcp.controller.js';

test(
  'two instances mount only local published global collections and revoke remote access',
  { timeout: 120_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'octopus-knowledge-mcp-'));
    const first = join(root, 'first', 'agent');
    const second = join(root, 'second', 'custom-agent');
    const server = Fastify();
    t.after(async () => {
      await server.close();
      await Promise.all([stopKnowledgeService(first), stopKnowledgeService(second)]);
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });
    await Promise.all([startKnowledgeService(first), startKnowledgeService(second)]);
    const client = (agentDir) =>
      createKnowledgeClient({
        agentDir,
        context: {
          principal: 'mcp-test',
          globalWrite: true,
          modelAccess: 'manage',
          workspaceId: 'workspace-a',
        },
      });
    const a = client(first),
      b = client(second);
    const local = await a.call('collections.create', { scope: { kind: 'global' }, name: '共享产品手册' });
    const privateCollection = await a.call('collections.create', {
      scope: { kind: 'workspace', workspaceId: 'workspace-a' },
      name: '工作区秘密',
    });
    const config = {
      revision: 0,
      enabled: true,
      collectionIds: [local.id],
      network: 'loopback',
      allowedHosts: ['127.0.0.1'],
      allowedOrigins: [],
    };
    await assert.rejects(a.call('sharing.save', { ...config, collectionIds: [privateCollection.id] }), {
      code: 'FORBIDDEN',
    });
    const publication = await a.call('sharing.save', config);
    assert.ok(publication.token);
    registerKnowledgeMcpController(server, first);
    const address = await server.listen({ host: '127.0.0.1', port: 0 });
    const url = address + '/mcp/knowledge';
    await writeFile(
      join(second, 'mcp.json'),
      JSON.stringify({ mcpServers: { upstream: { url, auth: 'bearer', bearerToken: publication.token } } })
    );
    assert.equal(
      (
        await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        })
      ).status,
      401
    );
    const mount = await b.call('mounts.create', { connectionRef: 'upstream' });
    assert.equal(mount.catalog.length, 1);
    const catalog = await b.call('collections.list', {});
    assert.equal(catalog.items.length, 1);
    assert.equal(catalog.items[0].source, 'remote');
    const remoteId = catalog.items[0].id;
    await assert.rejects(b.call('sharing.save', { ...config, collectionIds: [remoteId] }), {
      code: 'FORBIDDEN',
    });
    await assert.rejects(b.call('mounts.create', { connectionRef: 'upstream' }), {
      code: 'REVISION_CONFLICT',
    });
    if (process.env.OCTOPUS_KNOWLEDGE_MODEL_TEST === '1') {
      const endpoint = process.env.OCTOPUS_KNOWLEDGE_EMBEDDING_URL;
      assert.ok(endpoint, 'OCTOPUS_KNOWLEDGE_EMBEDDING_URL is required for live model tests');
      await a.call('settings.save', {
        revision: 0,
        config: {
          kind: 'embedding',
          endpoint,
          model: 'bge-m3',
          dimensions: 1024,
          batchSize: 8,
          timeoutMs: 30_000,
        },
      });
      const blob = await a.upload(
        Buffer.from('知识库允许递归导入压缩文档，扫描版 PDF 使用 PaddleOCR 识别。')
      );
      const job = await a.call('jobs.import', {
        collectionId: local.id,
        requestId: randomUUID(),
        source: { title: '手册.md', format: 'md', blobSha256: blob.sha256 },
      });
      let status;
      for (let i = 0; i < 300; i++) {
        status = (await a.call('jobs.get', { id: job.id })).job;
        if (['succeeded', 'failed', 'partial'].includes(status.state)) break;
        await delay(100);
      }
      assert.equal(status.state, 'succeeded', JSON.stringify(status));
    }
    const result = await b.call('search', { collectionIds: [remoteId], query: '扫描版 PDF 如何识别？' });
    assert.equal(result.coverage, 'complete', JSON.stringify(result));
    if (process.env.OCTOPUS_KNOWLEDGE_MODEL_TEST === '1') {
      assert.ok(result.hits.length);
      assert.ok((await b.call('read', { citationId: result.hits[0].citationId })).text.includes('PaddleOCR'));
    }
    await a.call('sharing.save', { ...config, revision: publication.settings.revision, rotateToken: true });
    await assert.rejects(b.call('mounts.refresh', { id: mount.id }));
    assert.equal(
      (await b.call('collections.list', {})).items.length,
      1,
      'failed refresh retains full catalog'
    );
    assert.equal(
      (await b.call('search', { collectionIds: [remoteId], query: '扫描 PDF' })).coverage,
      'unavailable'
    );
    if (result.hits.length) await assert.rejects(b.call('read', { citationId: result.hits[0].citationId }));
    await b.call('mounts.delete', { id: mount.id });
    assert.equal((await b.call('collections.list', {})).total, 0);
  }
);
