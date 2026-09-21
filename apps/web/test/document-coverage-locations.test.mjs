/**
 * @author Codex
 * @description Checks generic coverage locators retain reported gaps and actual Office positions.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { coverageLocationsLabel } from '../src/features/session/document-coverage-locations.ts';

/**
 * Returns the source default with interpolation so assertions pin the English contract.
 */
const t = (key, defaultValue, options) =>
  defaultValue.replace(/\{\{(\w+)\}\}/g, (_, name) => String(options?.[name] ?? ''));

test('Only consecutive reported pages or slides become ranges', () => {
  assert.equal(coverageLocationsLabel(t, [3, 1, 2, 6, 6, 8].map((page) => ({ page }))), 'Pages 1–3, 6, 8');
  assert.equal(coverageLocationsLabel(t, [2, 3, 7].map((slide) => ({ slide }))), 'Slides 2–3, 7');
  assert.equal(coverageLocationsLabel(t, []), 'No specific locations provided');
  assert.equal(coverageLocationsLabel(t, [{}]), 'No specific locations provided');
});

test('Mixed and Office locators retain their dimensions without invented pages', () => {
  const text = coverageLocationsLabel(t, [
    { sheet: '数据', part: 'xl/worksheets/sheet8.xml', region: '图表区域' },
    { page: 2, region: '页脚' },
  ]);
  assert.match(text, /Sheet "数据", Part xl\/worksheets\/sheet8\.xml, Region 图表区域/u);
  assert.match(text, /Page 2, Region 页脚/u);
  assert.doesNotMatch(text, /Page 8/u);
});
