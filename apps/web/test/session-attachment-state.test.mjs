/**
 * @author Codex
 * @description Preserves attachment draft persistence and shared upload cancellation across Session file moves.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  abortAttachmentUploadTask,
  persistAttachmentDraft,
  registerAttachmentUploadTask,
  restoreAttachmentDraft,
  unregisterAttachmentUploadTask,
} from '../src/stores/session/index.ts';

/**
 * Installs isolated browser storage without changing the production storage contract.
 */
function storageFixture(t) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const records = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => records.get(key) ?? null,
      setItem: (key, value) => records.set(key, value),
      removeItem: (key) => records.delete(key),
    },
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  });
  return records;
}

test('attachment drafts retain durable identities and restore processing state within their scope', (t) => {
  const records = storageFixture(t);
  const draft = {
    id: 'attachment-1',
    name: 'notes.txt',
    byteSize: 12,
    revision: 3,
    status: 'ready',
    uploadFingerprint: 'fingerprint-1',
  };
  persistAttachmentDraft('workspace-1', 'session-1', [
    { ...draft, id: 'local-pending' },
    { ...draft, browserOnly: 'must not persist' },
  ]);
  assert.deepEqual(JSON.parse(records.get('octopus:attachment-draft:workspace-1:session-1')), [draft]);
  assert.deepEqual(restoreAttachmentDraft('workspace-1', 'session-1'), [{ ...draft, status: 'processing' }]);
  assert.deepEqual(restoreAttachmentDraft('workspace-2', 'session-1'), []);
  persistAttachmentDraft('workspace-1', 'session-2', [draft]);
  persistAttachmentDraft('workspace-1', 'session-1', []);
  assert.equal(records.has('octopus:attachment-draft:workspace-1:session-1'), false);
  assert.equal(restoreAttachmentDraft('workspace-1', 'session-2').length, 1);
  records.set('octopus:attachment-draft:workspace-1:session-1', '{malformed');
  assert.deepEqual(restoreAttachmentDraft('workspace-1', 'session-1'), []);
});

test('upload cancellation forgets the shared task before awaiting abort and settlement removes it', async (t) => {
  const key = 'attachment-test-active';
  t.after(() => unregisterAttachmentUploadTask(key));
  let finish;
  let calls = 0;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  registerAttachmentUploadTask(key, {
    abort: () => {
      calls += 1;
      return pending;
    },
  });
  const cancellation = abortAttachmentUploadTask(key);
  assert.equal(calls, 1);
  assert.equal(await abortAttachmentUploadTask(key), false);
  finish();
  assert.equal(await cancellation, true);
  registerAttachmentUploadTask(key, {
    abort: () => {
      calls += 1;
    },
  });
  unregisterAttachmentUploadTask(key);
  assert.equal(await abortAttachmentUploadTask(key), false);
  assert.equal(calls, 1);
});

test('failed upload cancellation propagates its error without retaining the task', async (t) => {
  const key = 'attachment-test-rejected';
  t.after(() => unregisterAttachmentUploadTask(key));
  const failure = new Error('abort failed');
  registerAttachmentUploadTask(key, {
    abort: async () => {
      throw failure;
    },
  });
  await assert.rejects(abortAttachmentUploadTask(key), (error) => error === failure);
  assert.equal(await abortAttachmentUploadTask(key), false);
});
