/**
 * @author Codex
 * @description Session-scoped Host capabilities reject forged references and copy originals independently of attachments.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import {
  issueKnowledgeImportTicket,
  readKnowledgeImportTicket,
} from '../dist/extensions/knowledge/sdk/import-ticket.js';
import { createKnowledgeApplication } from '../dist/extensions/knowledge/daemon/application.js';

test(
  'attachment ticket scopes, integrity and independent accepted original ownership',
  { timeout: 30_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'octopus-knowledge-ticket-'));
    const agentDir = join(root, 'custom-agent');
    await mkdir(agentDir, { recursive: true });
    await mkdir(join(root, 'knowledge'));
    const app = await createKnowledgeApplication(join(root, 'knowledge'), agentDir);
    const model = createServer(async (req, res) => {
      let text = '';
      for await (const chunk of req) text += chunk;
      const input = JSON.parse(text).input;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: input.map((_text, index) => ({ index, embedding: [1, 0] })) }));
    });
    await new Promise((resolve) => model.listen(0, '127.0.0.1', resolve));
    t.after(async () => {
      await app.close();
      await new Promise((resolve) => model.close(resolve));
      await rm(root, { recursive: true, force: true });
    });
    const path = join(root, 'original.md');
    const bytes = Buffer.from('知识库原文是独立副本，不因删除聊天附件而丢失。');
    await writeFile(path, bytes);
    const input = {
      workspaceId: 'w1',
      agentSessionId: 's1',
      attachmentId: 'a1',
      path,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      byteSize: bytes.length,
      title: 'original.md',
    };
    const ticket = await issueKnowledgeImportTicket(agentDir, input);
    await access(join(root, 'knowledge', 'attachment-ticket-key'));
    await assert.rejects(access(join(agentDir, 'knowledge')), { code: 'ENOENT' });
    assert.ok(!ticket.includes(path));
    assert.deepEqual((await readKnowledgeImportTicket(agentDir, ticket, 'w1', 's1')).bytes, bytes);
    await assert.rejects(readKnowledgeImportTicket(agentDir, ticket, 'w2', 's1'), { code: 'FORBIDDEN' });
    await assert.rejects(readKnowledgeImportTicket(agentDir, ticket, 'w1', 's2'), { code: 'FORBIDDEN' });
    await assert.rejects(readKnowledgeImportTicket(agentDir, ticket.slice(0, -5) + 'AAAAA', 'w1', 's1'), {
      code: 'ATTACHMENT_REF_INVALID',
    });
    await writeFile(path, Buffer.alloc(bytes.length));
    await assert.rejects(readKnowledgeImportTicket(agentDir, ticket, 'w1', 's1'), { code: 'SOURCE_CORRUPT' });
    await writeFile(path, bytes);
    const context = {
      principal: 'test',
      workspaceId: 'w1',
      agentSessionId: 's1',
      globalWrite: false,
      modelAccess: 'none',
    };
    const call = (operation, input) => app.call({ context, operation, input });
    await app.call({
      context: { ...context, globalWrite: true, modelAccess: 'manage' },
      operation: 'settings.save',
      input: {
        revision: 0,
        config: {
          kind: 'embedding',
          model: 'fixture',
          endpoint: `http://127.0.0.1:${model.address().port}/v1`,
          dimensions: 2,
          batchSize: 8,
          timeoutMs: 1000,
        },
      },
    });
    const collection = await call('collections.create', {
      scope: { kind: 'workspace', workspaceId: 'w1' },
      name: '附件知识',
    });
    const admission = { collectionId: collection.id, requestId: randomUUID(), attachmentRef: ticket };
    const job = await call('jobs.importAttachment', admission);
    await rm(path);
    assert.equal(
      (await call('jobs.importAttachment', admission)).id,
      job.id,
      'lost admission response replays without rereading a deleted chat source'
    );
    let status;
    for (let i = 0; i < 100; i++) {
      status = (await call('jobs.get', { id: job.id })).job;
      if (!['queued', 'running'].includes(status.state)) break;
      await delay(50);
    }
    assert.equal(status.state, 'succeeded', JSON.stringify(status));
    const result = await call('search', { collectionIds: [collection.id], query: '删除聊天附件' });
    assert.ok(result.hits[0].text.includes('独立副本'));
  }
);
