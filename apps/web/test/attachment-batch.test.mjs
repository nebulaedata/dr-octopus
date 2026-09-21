/**
 * @author Codex
 * @description Verifies attachment polling remains ordered beyond the Server per-request batch limit.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';

const requests = [];
axios.defaults.adapter = async (config) => {
  const ids = config.params.ids.split(',');
  requests.push(ids);
  assert.ok(ids.length <= 10);
  return {
    data: { items: ids.map((id) => ({ id })) },
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  };
};
const { getAttachments } = await import('../src/api/attachments.ts');

test('polls more than ten attachments in bounded batches without losing order', async () => {
  requests.length = 0;
  const ids = Array.from({ length: 23 }, (_, index) => `attachment-${index}`);
  const result = await getAttachments('workspace-a', ids);
  assert.deepEqual(requests.map((batch) => batch.length), [10, 10, 3]);
  assert.deepEqual(result.items.map((item) => item.id), ids);
});

test('an empty attachment selection makes no batch requests', async () => {
  requests.length = 0;
  assert.deepEqual(await getAttachments('workspace-a', []), { items: [] });
  assert.equal(requests.length, 0);
});
