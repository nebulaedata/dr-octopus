/**
 * @author Codex
 * @description Verifies explicit-only initialization, short-lived review reuse and configuration invalidation.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthorizationPreviews } from '../dist/extensions/scheduler/sdk/authorization-previews.js';

const task = {
  id: 'task',
  revision: 1,
  cwd: '/workspace',
  workspaceId: 'workspace',
  configRevision: 'v1',
  prompt: 'Check news',
  timeoutMs: 1000,
};
const tool = { name: 'lazy_tool', identity: 'a'.repeat(64), description: 'Lazy tool' };

test('only list requests initialize, concurrent lists coalesce, approvals reuse an immutable result', async () => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let calls = 0;
  const previews = new AuthorizationPreviews(
    async () => {
      calls++;
      entered.resolve();
      await release.promise;
      return [tool];
    },
    async () => 'config'
  );
  await assert.rejects(previews.reviewed(task), /Open or refresh/);
  assert.equal(calls, 0);
  const first = previews.request(task);
  await entered.promise;
  const second = previews.request(task);
  await assert.rejects(previews.reviewed(task), /Open or refresh/);
  release.resolve();
  const [a, b] = await Promise.all([first, second]);
  a[0].description = 'Forged';
  assert.deepEqual(b, [tool]);
  assert.deepEqual(await previews.reviewed(task), [tool]);
  assert.equal(calls, 1);
  await previews.request(task);
  assert.equal(calls, 2);
});

test('expiry, task edits and configuration edits require refresh without initializing on approval', async () => {
  let now = 100;
  let configuration = 'v1';
  let calls = 0;
  const previews = new AuthorizationPreviews(
    async () => {
      calls++;
      return [tool];
    },
    async () => configuration,
    () => now
  );
  await previews.request(task);
  await assert.rejects(previews.reviewed({ ...task, revision: 2 }), /Open or refresh/);
  configuration = 'v2';
  await assert.rejects(previews.reviewed(task), /configuration changed/);
  assert.equal(calls, 1);
  await previews.request(task);
  now += 120001;
  await assert.rejects(previews.reviewed(task), /Open or refresh/);
  assert.equal(calls, 2);
});

test('initialization failure or a configuration change during initialization leaves no approvable result', async () => {
  let revision = 'v1';
  let fail = true;
  const previews = new AuthorizationPreviews(
    async () => {
      if (fail) throw new Error('Provider initialization failed');
      revision = 'v2';
      return [tool];
    },
    async () => revision
  );
  await assert.rejects(previews.request(task), /Provider initialization/);
  await assert.rejects(previews.reviewed(task), /Open or refresh/);
  fail = false;
  await assert.rejects(previews.request(task), /configuration changed/);
  await assert.rejects(previews.reviewed(task), /Open or refresh/);
  assert.deepEqual(await previews.request(task), [tool]);
});

test('an expired result cannot be submitted after an asynchronous configuration read', async () => {
  let now = 0;
  let expire = false;
  const previews = new AuthorizationPreviews(
    async () => [tool],
    async () => {
      if (expire) now = 120001;
      return 'config';
    },
    () => now
  );
  await previews.request(task);
  expire = true;
  await assert.rejects(previews.reviewed(task), /expired/);
});
