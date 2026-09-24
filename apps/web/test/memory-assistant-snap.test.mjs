/**
 * @author Codex
 * @description Verifies that the Memory Assistant always rests beside the closest reachable browser viewport edge.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampMemoryAssistantPosition,
  computeMemoryAssistantSnapTarget,
  MEMORY_ASSISTANT_SNAP_MARGIN,
} from '../src/features/session/utils/memory-assistant-snap.ts';

const viewport = { width: 1000, height: 800 };
const size = { width: 200, height: 72 };
const margin = MEMORY_ASSISTANT_SNAP_MARGIN;

test('snaps to the right edge when resting in the right half', () => {
  const target = computeMemoryAssistantSnapTarget({ x: 700, y: 300, ...size }, viewport, margin);
  assert.equal(target.edge, 'right');
  assert.equal(target.x, viewport.width - size.width - margin);
  assert.equal(target.y, 300);
});

test('snaps to the left edge when resting in the left half', () => {
  const target = computeMemoryAssistantSnapTarget({ x: 60, y: 300, ...size }, viewport, margin);
  assert.equal(target.edge, 'left');
  assert.equal(target.x, margin);
  assert.equal(target.y, 300);
});

test('snaps to the top or bottom edge when closer vertically than horizontally', () => {
  const top = computeMemoryAssistantSnapTarget({ x: 400, y: 40, ...size }, viewport, margin);
  assert.equal(top.edge, 'top');
  assert.equal(top.y, margin);
  const bottom = computeMemoryAssistantSnapTarget({ x: 400, y: 730, ...size }, viewport, margin);
  assert.equal(bottom.edge, 'bottom');
  assert.equal(bottom.y, viewport.height - size.height - margin);
});

test('clamps the cross axis so the assistant never leaves the viewport', () => {
  const right = computeMemoryAssistantSnapTarget({ x: 700, y: -500, ...size }, viewport, margin);
  assert.equal(right.edge, 'right');
  assert.equal(right.y, margin);
  const bottom = computeMemoryAssistantSnapTarget({ x: 5000, y: 730, ...size }, viewport, margin);
  assert.equal(bottom.edge, 'bottom');
  assert.equal(bottom.x, viewport.width - size.width - margin);
});

test('prefers horizontal edges on exact ties for a predictable bubble side', () => {
  const target = computeMemoryAssistantSnapTarget({ x: 100, y: 100, ...size }, viewport, margin);
  assert.equal(target.edge, 'left');
  assert.equal(target.x, margin);
});

test('clamp keeps positions reachable even in a viewport smaller than the assistant', () => {
  const tiny = { width: 100, height: 60 };
  const clamped = clampMemoryAssistantPosition({ x: 500, y: -20 }, size, tiny, margin);
  assert.equal(clamped.x, margin);
  assert.equal(clamped.y, margin);
});
