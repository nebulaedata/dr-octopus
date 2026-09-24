/**
 * @author Codex
 * @description Covers successful polling responses that carry failed, partial, or blocked knowledge jobs.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getKnowledgeJobFailure,
  getKnowledgeJobNotification,
} from '../src/features/knowledge/utils/knowledge-job-feedback.ts';

const t = (key, defaultValue, options) =>
  defaultValue.replace(/\{\{(\w+)\}\}/g, (_, name) => String(options?.[name] ?? ''));

test('duplicate archive documents report an actionable message instead of an internal error code', () => {
  const notification = getKnowledgeJobNotification(t, {
    ...result('partial', { error: 'DOCUMENT_FAILED' }),
    leaves: [{ status: 'failed', reason: 'DOCUMENT_DUPLICATE_CONFLICT' }],
  });
  assert.equal(notification.type, 'error');
  assert.equal(
    notification.description,
    'This document already exists or is being imported; do not upload it again.'
  );
});

/**
 * Builds the polling fields consumed by the notification projection without network or model dependencies.
 */
function result(state, overrides = {}) {
  return {
    job: { id: 'job-1', attempt: 1, kind: 'import', state, error: null, blockedReason: null, ...overrides },
    leaves: [{ id: 'leaf-1', archivePath: 'scan.pdf', status: 'failed', reason: 'OCR_NOT_CONFIGURED' }],
  };
}

test('completion and cancellation become toasts, and active work keeps its cancel action', () => {
  const complete = getKnowledgeJobNotification(t, result('succeeded', { kind: 'reindex' }));
  assert.equal(complete.title, 'Index rebuild: Completed');
  assert.equal(complete.type, 'success');
  assert.equal(complete.action, undefined);
  assert.equal(complete.description, undefined);
  assert.equal(getKnowledgeJobNotification(t, result('succeeded')).title, 'Document import: Completed');
  const cancelled = getKnowledgeJobNotification(t, result('cancelled'));
  assert.equal(cancelled.type, 'info');
  assert.equal(cancelled.action, 'retry');
  for (const state of ['queued', 'running']) {
    const progress = getKnowledgeJobNotification(t, result(state));
    assert.equal(progress.type, 'loading');
    assert.equal(progress.action, 'cancel');
    assert.equal(progress.timeout, 0);
  }
});

test('reports leaf-only OCR failure with readable configuration guidance and retry', () => {
  const failure = getKnowledgeJobFailure(t, result('failed'));
  assert.equal(failure.title, 'Document import failed');
  assert.equal(failure.description, 'Configure an OCR model in Settings - Knowledge.');
  assert.equal(failure.retryable, true);
});

test('polling retains notification identity while a new retry attempt can notify again', () => {
  const first = getKnowledgeJobFailure(t, result('failed'));
  assert.equal(getKnowledgeJobFailure(t, result('failed')).key, first.key);
  assert.notEqual(getKnowledgeJobFailure(t, result('failed', { attempt: 2 })).key, first.key);
  assert.notEqual(getKnowledgeJobFailure(t, result('failed', { id: 'job-2' })).key, first.key);
});

test('partial and blocked jobs expose failures without treating a dependency wait as retryable', () => {
  assert.equal(
    getKnowledgeJobFailure(t, result('partial', { kind: 'reindex' })).title,
    'Reindexing partially failed'
  );
  const blocked = result('waiting_dependency', { blockedReason: 'MODEL_NOT_CONFIGURED' });
  blocked.leaves = [];
  assert.equal(getKnowledgeJobFailure(t, blocked).retryable, false);
  assert.equal(
    getKnowledgeJobFailure(t, blocked).description,
    'Configure an Embedding model in Settings - Knowledge.'
  );
});

test('healthy job states do not replay old leaf failures and duplicate reasons are collapsed', () => {
  for (const state of ['queued', 'running', 'succeeded', 'cancelled']) {
    assert.equal(getKnowledgeJobFailure(t, result(state)), undefined);
  }
  assert.equal(
    getKnowledgeJobFailure(t, result('failed', { error: 'OCR_NOT_CONFIGURED' })).description,
    'Configure an OCR model in Settings - Knowledge.'
  );
  const empty = result('failed');
  empty.leaves = [];
  assert.equal(
    getKnowledgeJobFailure(t, empty).description,
    'The task could not complete. Check the model service and retry.'
  );
});

test('OCR truncation explains the recognition failure without masking it with a generic document error', () => {
  const failed = result('failed', { error: 'DOCUMENT_FAILED' });
  failed.leaves[0].reason = 'OCR_INCOMPLETE';
  const failure = getKnowledgeJobFailure(t, failed);
  assert.match(failure.description, /OCR output did not finish completely/u);
  assert.match(failure.description, /generated repeatedly/u);
  assert.ok(!failure.description.includes('DOCUMENT_FAILED'));
  failed.leaves = [];
  assert.equal(getKnowledgeJobFailure(t, failed).description, 'DOCUMENT_FAILED');
});
