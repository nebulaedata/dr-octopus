/**
 * @author Codex
 * @description Verifies native upload failures preserve safe Server text and authoritative retryability.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DetailedError } from 'tus-js-client';
import { projectAttachmentUploadError } from '../src/api/attachments.ts';
import { ApiRequestError } from '../src/utils/request.ts';

test('upload failures expose the Server message and retry declaration instead of tus transport details', () => {
  for (const retryable of [true, false]) {
    const original = new DetailedError('tus internal request details');
    original.originalResponse = {
      getStatus: () => 507,
      getBody: () =>
        JSON.stringify({
          error: {
            code: 'ATTACHMENT_STORAGE_PRESSURE',
            message: 'Attachment storage is under pressure.',
            retryable,
          },
        }),
    };
    const failure = projectAttachmentUploadError(original);
    assert.ok(failure instanceof ApiRequestError);
    assert.equal(failure.message, 'Attachment storage is under pressure.');
    assert.equal(failure.retryable, retryable);
    assert.equal(failure.statusCode, 507);
  }
});

test('malformed and absent HTTP error contracts retain the original error', () => {
  const network = new Error('Network unavailable');
  assert.equal(projectAttachmentUploadError(network), network);
  const original = new DetailedError('unexpected response');
  original.originalResponse = { getBody: () => 'not JSON' };
  assert.equal(projectAttachmentUploadError(original), original);
});
