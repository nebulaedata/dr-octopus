/**
 * @author Codex
 * @description Verifies delegated policy parity, parent mode snapshots and nontransferable session approvals.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONFIG_DIR_NAME } from '@earendil-works/pi-coding-agent';
import {
  createPermissionModeService,
  captureDelegatedPermissions,
  evaluateDelegatedPermission,
} from '../dist/extensions/permission-system/sdk/index.js';
import { normalizePermissionRequest } from '../dist/extensions/permission-system/services/permission-request.js';

/**
 * Create isolated permission files without model or daemon initialization.
 */
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'delegated-permission-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agentDir = join(root, 'agent');
  const cwd = join(root, 'workspace');
  await mkdir(agentDir);
  await mkdir(join(cwd, CONFIG_DIR_NAME), { recursive: true });
  return { root, agentDir, cwd, service: createPermissionModeService({ agentDir, cwd }) };
}

test('delegated rules preserve parent mode and static denies without copying session approval', async (t) => {
  const { agentDir, cwd, service } = await fixture(t);
  service.reloadPolicy(cwd, false);
  const request = normalizePermissionRequest(
    'write',
    { path: 'result.txt' },
    cwd,
    service.getConfiguration()
  ).request;
  assert.ok(request.sessionApprovalKey);
  service.recordSessionApproval(request.sessionApprovalKey);
  assert.equal(service.decide(request), 'allow');
  const snapshot = captureDelegatedPermissions(service, cwd, false);
  assert.equal(service.decide(request), 'allow');
  assert.equal(evaluateDelegatedPermission(snapshot, 'write', { path: 'result.txt' }, cwd).decision, 'ask');
  service.setMode('full');
  const full = captureDelegatedPermissions(service, cwd, false);
  assert.equal(evaluateDelegatedPermission(full, 'embed_text', { texts: ['one'] }, cwd).decision, 'allow');
  assert.equal(evaluateDelegatedPermission(snapshot, 'embed_text', { texts: ['one'] }, cwd).decision, 'ask');
  await writeFile(
    join(agentDir, 'permission-system.json'),
    JSON.stringify({ policy: { tools: { embed_text: 'deny', rerank_documents: 'ask' } } })
  );
  const restricted = captureDelegatedPermissions(service, cwd, false);
  assert.equal(evaluateDelegatedPermission(restricted, 'embed_text', {}, cwd).decision, 'deny');
  assert.equal(evaluateDelegatedPermission(restricted, 'rerank_documents', {}, cwd).decision, 'ask');
});

test('delegated normalization preserves sensitive paths and external confirmation boundaries', async (t) => {
  const { cwd, service } = await fixture(t);
  service.setMode('full');
  const full = captureDelegatedPermissions(service, cwd, false);
  assert.equal(
    service.decide(
      normalizePermissionRequest('ocr_image', { path: '.ssh/key.png' }, cwd, service.getConfiguration())
        .request
    ),
    'deny'
  );
  assert.equal(
    evaluateDelegatedPermission(full, 'ocr_image', { path: '.ssh/key.png' }, cwd).decision,
    'deny'
  );
  service.setMode('ask');
  const scoped = captureDelegatedPermissions(service, cwd, false);
  assert.equal(evaluateDelegatedPermission(scoped, 'read', { path: '../external.txt' }, cwd).decision, 'ask');
  assert.throws(() => evaluateDelegatedPermission(undefined, 'read', {}, cwd), /SNAPSHOT_INVALID/);
});

test('project rules participate only with parent trust and malformed policy blocks capture', async (t) => {
  const { agentDir, cwd, service } = await fixture(t);
  service.setMode('full');
  await writeFile(
    join(cwd, CONFIG_DIR_NAME, 'permission-system.json'),
    JSON.stringify({ policy: { tools: { ocr_image: 'deny' } } })
  );
  assert.equal(
    evaluateDelegatedPermission(captureDelegatedPermissions(service, cwd, false), 'ocr_image', {}, cwd)
      .decision,
    'allow'
  );
  assert.equal(
    evaluateDelegatedPermission(captureDelegatedPermissions(service, cwd, true), 'ocr_image', {}, cwd)
      .decision,
    'deny'
  );
  await writeFile(join(agentDir, 'permission-system.json'), '{ invalid');
  assert.throws(() => captureDelegatedPermissions(service, cwd, true), /CONFIG_INVALID/);
});

test('child cwd cannot reclassify a parent-external OCR path as authorized', async (t) => {
  const { root, agentDir, cwd, service } = await fixture(t);
  await writeFile(
    join(agentDir, 'permission-system.json'),
    JSON.stringify({ policy: { tools: { ocr_image: 'allow' } } })
  );
  service.setMode('auto');
  const snapshot = captureDelegatedPermissions(service, cwd, false);
  const outside = join(root, 'outside');
  assert.equal(
    evaluateDelegatedPermission(snapshot, 'ocr_image', { path: join(outside, 'page.png') }, outside).decision,
    'ask'
  );
  assert.equal(
    evaluateDelegatedPermission(snapshot, 'ocr_image', { path: 'page.png' }, outside).decision,
    'ask'
  );
  assert.equal(
    evaluateDelegatedPermission(snapshot, 'ocr_image', { path: join(cwd, 'page.png') }, outside).decision,
    'allow'
  );
  assert.equal(
    evaluateDelegatedPermission(snapshot, 'ocr_image', { path: '../workspace/page.png' }, outside).decision,
    'allow'
  );
});
