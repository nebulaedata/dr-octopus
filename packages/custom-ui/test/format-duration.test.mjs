/**
 * @author longlongago2
 * @description Locks duration formatting boundaries and preserves legacy compact/clock behaviors.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDuration } from '../src/components/elapsed-time/format-duration.ts';

test('auto format covers the documented boundaries', () => {
  assert.equal(formatDuration(0), '0ms');
  assert.equal(formatDuration(999), '999ms');
  assert.equal(formatDuration(1000), '1.0s');
  assert.equal(formatDuration(2384), '2.4s');
  assert.equal(formatDuration(18_243), '18.2s');
  assert.equal(formatDuration(59_900), '59.9s');
  assert.equal(formatDuration(60_000), '1:00');
  assert.equal(formatDuration(73_480), '1:13');
  assert.equal(formatDuration(3_600_000), '1:00:00');
});

test('explicit formats bypass auto selection', () => {
  assert.equal(formatDuration(683, 'milliseconds'), '683ms');
  assert.equal(formatDuration(2384, 'seconds'), '2.4s');
  assert.equal(formatDuration(75_000, 'clock'), '1:15');
});

test('clock format keeps fixed width and hour rollover', () => {
  assert.equal(formatDuration(7_000, 'clock'), '0:07');
  assert.equal(formatDuration(599_000, 'clock'), '9:59');
  assert.equal(formatDuration(3_661_000, 'clock'), '1:01:01');
});

test('compact format preserves the legacy sparse-parts behavior', () => {
  assert.equal(formatDuration(0, 'compact'), '1s');
  assert.equal(formatDuration(45_000, 'compact'), '45s');
  assert.equal(formatDuration(60_000, 'compact'), '1m 0s');
  assert.equal(formatDuration(3_723_000, 'compact'), '1h 2m 3s');
  assert.equal(formatDuration(3_600_000, 'compact'), '1h 0s');
});

test('negative values clamp to zero', () => {
  assert.equal(formatDuration(-500), '0ms');
  assert.equal(formatDuration(-500, 'clock'), '0:00');
  assert.equal(formatDuration(-500, 'compact'), '1s');
});
