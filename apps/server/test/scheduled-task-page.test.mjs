/**
 * @author Codex
 * @description Verifies global pagination across independently ordered workspace catalogs.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeTaskPage, mergeSortedPage } from '../dist/modules/scheduled-tasks/scheduled-tasks.utils.js';

test('history merges instants across timezone encodings and retains workspace identity', async () => {
  const newer = { id: 'a', workspaceId: 'a', scheduledFor: '2026-09-06T08:00:00Z' };
  const older = { id: 'z', workspaceId: 'b', scheduledFor: '2026-09-06T15:00:00+08:00' };
  const page = await mergeSortedPage(
    [async () => [older], async () => [newer]],
    0,
    20,
    (a, b) => Date.parse(b.scheduledFor) - Date.parse(a.scheduledFor)
  );
  assert.deepEqual(page, [newer, older]);
});

test('global pages merge workspace rows, use stable ties and refill bounded batches', async () => {
  const rows = Array.from({ length: 245 }, (_, index) => ({
    id: String(999 - index),
    updatedAt: '2026-09-06',
    workspaceId: index % 2 ? 'a' : 'b',
  }));
  const calls = [];
  const readers = ['a', 'b'].map((workspace) => async (offset, limit) => {
    calls.push({ offset, limit });
    return rows.filter((row) => row.workspaceId === workspace).slice(offset, offset + limit);
  });
  assert.deepEqual(await mergeTaskPage(readers, 0, 21), rows.slice(0, 21));
  assert.deepEqual(await mergeTaskPage(readers, 200, 21), rows.slice(200, 221));
  assert.ok(calls.some((call) => call.offset === 100));
  assert.ok(calls.every((call) => call.limit === 100));
  assert.deepEqual(await mergeTaskPage(readers, 240, 21), rows.slice(240));
  assert.deepEqual(await mergeTaskPage(readers, 260, 21), []);
});

test('newest update sorts first and a failed workspace never produces an incomplete page', async () => {
  const older = { id: 'z', updatedAt: '2026-09-05' };
  const newer = { id: 'a', updatedAt: '2026-09-06' };
  assert.deepEqual(await mergeTaskPage([async () => [older], async () => [newer]], 0, 20), [newer, older]);
  assert.deepEqual(await mergeTaskPage([], 0, 20), []);
  await assert.rejects(
    mergeTaskPage(
      [
        async () => [older],
        async () => {
          throw new Error('offline');
        },
      ],
      0,
      20
    ),
    /offline/
  );
});
