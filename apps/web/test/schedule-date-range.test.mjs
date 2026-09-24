/**
 * @author Codex
 * @description Verifies calendar history filters include whole local days and reject incomplete ranges.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { historyDateBounds } from '../src/features/schedules/utils/schedule-date-range.ts';

const t = (key, defaultValue) => defaultValue;

test('calendar boundaries include the entire end day without mutating selection', () => {
  const from = new Date(2026, 8, 5, 12);
  const to = new Date(2026, 8, 6, 12);
  assert.deepEqual(historyDateBounds(t, { from, to }), {
    from: new Date(2026, 8, 5, 0).toISOString(),
    to: new Date(2026, 8, 6, 23, 59, 59, 999).toISOString(),
  });
  assert.equal(from.getHours(), 12);
  assert.equal(to.getHours(), 12);
  assert.deepEqual(historyDateBounds(t, undefined), {});
  assert.throws(() => historyDateBounds(t, { from }), /complete date range/);
  assert.throws(() => historyDateBounds(t, { from: to, to: from }), /invalid/);
});
