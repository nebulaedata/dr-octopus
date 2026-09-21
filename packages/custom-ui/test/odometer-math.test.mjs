/**
 * @author longlongago2
 * @description Regression tests for the odometer roll-position and digit-count math.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ODOMETER_DIGIT_STRIP,
  odometerColumnPosition,
  odometerDigitCount,
  secondsDigitCount,
} from '../src/components/elapsed-time/odometer-math.ts';

test('secondsDigitCount grows one column per magnitude and never drops below one', () => {
  assert.equal(secondsDigitCount(0), 1);
  assert.equal(secondsDigitCount(999), 1);
  assert.equal(secondsDigitCount(1000), 1);
  assert.equal(secondsDigitCount(9999), 1);
  assert.equal(secondsDigitCount(10_000), 2);
  assert.equal(secondsDigitCount(99_999), 2);
  assert.equal(secondsDigitCount(100_000), 3);
});

test('secondsDigitCount clamps negative values to a single zero column', () => {
  assert.equal(secondsDigitCount(-500), 1);
});

test('continuous columns scroll proportionally to elapsed time', () => {
  assert.equal(odometerColumnPosition(0, 100, true), 0);
  assert.equal(odometerColumnPosition(1234, 100, true), 2.34);
  assert.ok(Math.abs(odometerColumnPosition(1999, 100, true) - 9.99) < 1e-9);
});

test('stepped columns rest on their digit outside the roll window', () => {
  assert.equal(odometerColumnPosition(1000, 1000, false), 1);
  assert.equal(odometerColumnPosition(1500, 1000, false), 1);
  assert.equal(odometerColumnPosition(1799, 1000, false), 1);
});

test('stepped columns roll during the last roll window of each cycle', () => {
  const mid = odometerColumnPosition(1900, 1000, false);
  assert.ok(mid > 1 && mid < 2, `expected mid-roll position, got ${String(mid)}`);
  assert.equal(odometerColumnPosition(2000, 1000, false), 2);
});

test('a carry approaches the duplicate trailing zero without overshooting the strip', () => {
  const nearCarry = odometerColumnPosition(19_999, 1000, false);
  assert.ok(nearCarry > 9.9 && nearCarry <= 10, `expected carry approach, got ${String(nearCarry)}`);
  assert.equal(odometerColumnPosition(20_000, 1000, false), 0);
  assert.equal(ODOMETER_DIGIT_STRIP[10], 0);
});

test('positions never go negative', () => {
  assert.equal(odometerColumnPosition(-250, 100, true), 0);
  assert.equal(odometerColumnPosition(-250, 1000, false), 0);
});

test('higher stepped columns rest until the synchronized carry window', () => {
  // A per-cycle-fraction roll would start the tens column at 8s, so a column
  // added at 9.8s would appear mid-roll and read "19s" just before 10s.
  assert.equal(odometerColumnPosition(8000, 10_000, false), 0);
  assert.equal(odometerColumnPosition(9799, 10_000, false), 0);
  const mid = odometerColumnPosition(9900, 10_000, false);
  assert.ok(mid > 0 && mid < 1, `expected synchronized mid-roll, got ${String(mid)}`);
  assert.equal(odometerColumnPosition(10_000, 10_000, false), 1);
  assert.equal(odometerColumnPosition(15_000, 10_000, false), 1);
});

test('odometerDigitCount grows one column as the roll window before a boundary starts', () => {
  assert.equal(odometerDigitCount(0), 1);
  assert.equal(odometerDigitCount(9799), 1);
  assert.equal(odometerDigitCount(9800), 2);
  assert.equal(odometerDigitCount(10_000), 2);
  assert.equal(odometerDigitCount(99_799), 2);
  assert.equal(odometerDigitCount(99_800), 3);
});
