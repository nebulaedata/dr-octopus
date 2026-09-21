/**
 * @author longlongago2
 * @description Verifies PreciseClock interpolation, drift immunity, re-anchoring, and freeze semantics.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { PreciseClock } from '../src/components/elapsed-time/precise-clock.ts';

test('start anchors a base value and interpolates forward', () => {
  let now = 1000;
  const clock = new PreciseClock(() => now);

  clock.start(500);
  now = 1500;

  assert.equal(clock.elapsedMs, 1000);
});

test('callback stalls never drift the elapsed value', () => {
  let now = 0;
  const clock = new PreciseClock(() => now);

  clock.start(0);
  now += 100;
  assert.equal(clock.elapsedMs, 100);

  now += 5000;
  assert.equal(clock.elapsedMs, 5100);
});

test('sync re-anchors to the authoritative snapshot', () => {
  let now = 0;
  const clock = new PreciseClock(() => now);

  clock.start(1000);
  now += 500;
  assert.equal(clock.elapsedMs, 1500);

  clock.sync(1600);
  now += 200;
  assert.equal(clock.elapsedMs, 1800);
});

test('stop with a final value freezes at that value', () => {
  let now = 0;
  const clock = new PreciseClock(() => now);

  clock.start(1000);
  now += 500;

  clock.stop(1520);
  now += 5000;

  assert.equal(clock.elapsedMs, 1520);
});

test('stop without a value freezes at the interpolated value', () => {
  let now = 0;
  const clock = new PreciseClock(() => now);

  clock.start(0);
  now += 800;

  clock.stop();
  now += 5000;

  assert.equal(clock.elapsedMs, 800);
});

test('a stopped clock stays frozen even after sync', () => {
  let now = 0;
  const clock = new PreciseClock(() => now);

  clock.start(0);
  now += 100;
  clock.stop(120);

  clock.sync(300);
  now += 1000;

  assert.equal(clock.elapsedMs, 300);
});

test('reset clears back to a stopped zero clock', () => {
  let now = 0;
  const clock = new PreciseClock(() => now);

  clock.start(1000);
  now += 500;
  clock.reset();

  assert.equal(clock.elapsedMs, 0);
  now += 500;
  assert.equal(clock.elapsedMs, 0);
});
