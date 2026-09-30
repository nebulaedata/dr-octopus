/**
 * @author Codex
 * @description Verifies safe API error projection for proxy failures and malformed response bodies.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { AxiosError } from 'axios';
import { request, ApiRequestError } from '../src/utils/request.ts';

/**
 * Supplies an isolated Axios adapter without reaching any real service.
 */
function failingRequest(data, status = 502) {
  return request({
    url: '/test',
    adapter: async (config) => {
      throw new AxiosError('Upstream unavailable', 'ERR_BAD_RESPONSE', config, undefined, {
        data,
        status,
        statusText: 'Bad Gateway',
        headers: {},
        config,
      });
    },
  });
}

test('empty, primitive, HTML and malformed response bodies retain the original HTTP failure', async () => {
  for (const payload of [
    '',
    null,
    undefined,
    '<html>proxy error</html>',
    1,
    false,
    [],
    { error: '' },
    { error: { message: {}, code: 7, retryable: 'no' } },
  ]) {
    await assert.rejects(failingRequest(payload), (error) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.message, 'Upstream unavailable');
      assert.equal(error.statusCode, 502);
      assert.equal(error.retryable, true);
      return true;
    });
  }
});

test('enveloped and flat API errors preserve validated messages and retry metadata', async () => {
  const projected = {
    code: 'INVALID_INPUT',
    message: 'Invalid input',
    retryable: false,
    requestId: 'req-test',
  };
  for (const payload of [projected, { error: projected }]) {
    await assert.rejects(failingRequest(payload, 422), (error) => {
      assert.equal(error.code, projected.code);
      assert.equal(error.message, projected.message);
      assert.equal(error.retryable, false);
      assert.equal(error.requestId, 'req-test');
      return true;
    });
  }
});
