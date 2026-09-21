/**
 * @author Codex
 * @description Opt-in real local model integration through the daemon's production application boundary.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createKnowledgeApplication } from '../dist/extensions/knowledge/daemon/application.js';
import { scannedPdf } from '../../document-processing/test/fixtures/scan-pdf.mjs';

test(
  'real local models import, hybrid search, rebuild and revoke retained evidence',
  {
    skip: process.env.OCTOPUS_KNOWLEDGE_MODEL_TEST !== '1',
    timeout: 180_000,
  },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'octopus-knowledge-integration-'));
    const app = await createKnowledgeApplication(directory, join(directory, 'agent'));
    t.after(async () => {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    });
    const context = {
      principal: 'integration',
      workspaceId: 'test-workspace',
      globalWrite: true,
      modelAccess: 'manage',
    };
    const call = (operation, input) => app.call({ operation, input, context });
    await call('settings.save', {
      revision: 0,
      config: {
        kind: 'embedding',
        endpoint: 'http://192.168.77.201:8031/v1',
        model: 'bge-m3',
        dimensions: 1024,
        batchSize: 8,
        timeoutMs: 30_000,
      },
    });
    await call('settings.save', {
      revision: 1,
      config: {
        kind: 'reranker',
        endpoint: 'http://192.168.77.201:8030/v1',
        model: 'bge-reranker-v2-m3',
        enabled: true,
        maxCandidates: 40,
        allowRemoteEvidence: false,
        timeoutMs: 30_000,
      },
    });
    await call('settings.save', {
      revision: 2,
      config: {
        kind: 'ocr',
        endpoint: 'http://192.168.77.201:8088/v1',
        model: 'PaddleOCR-VL-1.6-0.9B',
        mode: 'auto',
        maxOutputTokens: 4096,
        timeoutMs: 60_000,
      },
    });
    for (const config of Object.values(await call('settings.get', {})).filter(
      (item) => item && typeof item === 'object'
    )) {
      const editable = { ...config };
      delete editable.secretRef;
      assert.ok((await call('settings.probe', { config: editable })).summary.includes('正常'));
    }
    const collection = await call('collections.create', {
      scope: { kind: 'workspace', workspaceId: 'test-workspace' },
      name: '本地模型集成验证',
    });
    const blob = await app.blobs.put(
      Buffer.from(
        '知识库支持递归导入 ZIP 压缩文件，扫描版 PDF 通过 OCR 识别。\n\n集合重建期间旧索引仍可查询。'
      )
    );
    const input = {
      collectionId: collection.id,
      requestId: randomUUID(),
      source: { title: 'guide.md', format: 'md', blobSha256: blob.sha256 },
    };
    const job = await call('jobs.import', input);
    assert.equal((await call('jobs.import', input)).id, job.id);
    /**
     * Observe durable terminal state with a bounded deadline instead of relying on arbitrary parser timing.
     */
    async function complete(id) {
      for (let count = 0; count < 600; count++) {
        const outcome = await call('jobs.get', { id });
        if (!['running', 'queued', 'waiting_dependency'].includes(outcome.job.state)) {
          assert.equal(outcome.job.state, 'succeeded', JSON.stringify(outcome));
          return outcome;
        }
        await delay(100);
      }
      assert.fail('job deadline exceeded');
    }
    await complete(job.id);
    const result = await call('search', { collectionIds: [collection.id], query: '如何处理扫描版 PDF？' });
    assert.equal(result.coverage, 'complete', JSON.stringify(result));
    assert.equal(result.ranking.strategy, 'reranker');
    assert.ok(result.hits.some((hit) => hit.text.includes('OCR')));
    const citationId = result.hits[0].citationId;
    const previousGeneration = result.hits[0].generationId;
    await complete((await call('jobs.reindex', { collectionId: collection.id, requestId: randomUUID() })).id);
    const newer = await call('search', { collectionIds: [collection.id], query: '扫描 PDF' });
    assert.notEqual(newer.hits[0].generationId, previousGeneration);
    assert.equal((await call('read', { citationId })).chunkId, result.hits[0].chunkId);
    await assert.rejects(
      app.call({ operation: 'read', input: { citationId }, context: { ...context, workspaceId: 'other' } }),
      { code: 'NOT_FOUND' }
    );
    const document = (await call('documents.list', { collectionId: collection.id })).items[0];
    await call('documents.delete', { id: document.id, revision: document.revision });
    await assert.rejects(call('read', { citationId }), { code: 'EVIDENCE_GONE' });
    assert.equal(
      (await call('search', { collectionIds: [collection.id], query: '扫描 PDF' })).hits.length,
      0
    );
    const pdf = await app.blobs.put(scannedPdf());
    await complete(
      (
        await call('jobs.import', {
          collectionId: collection.id,
          requestId: randomUUID(),
          source: { title: '扫描测试.pdf', format: 'pdf', blobSha256: pdf.sha256 },
        })
      ).id
    );
    const scan = await call('search', { collectionIds: [collection.id], query: 'OCTOPUS KNOWLEDGE 2026' });
    assert.ok(scan.hits[0].text.includes('2026'));
    assert.equal(scan.hits[0].locator.page, 1);
    assert.equal(scan.hits[0].extractionMethod, 'ocr');
  }
);
