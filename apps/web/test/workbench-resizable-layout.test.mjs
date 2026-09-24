/**
 * @author Codex
 * @description Guards Workbench separator geometry when the optional right panel is collapsed.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('collapsed right panel keeps its disabled separator in the resizable layout flow', () => {
  const layout = readFileSync(new URL('../src/features/layout/Layout.tsx', import.meta.url), 'utf8');

  assert.match(
    layout,
    /disabled=\{!canShowRightPanel\}[\s\S]*?className=\{cn\(!canShowRightPanel && 'invisible'\)\}/u
  );
  assert.doesNotMatch(
    layout,
    /disabled=\{!canShowRightPanel\}[\s\S]*?className=\{cn\(!canShowRightPanel && 'hidden'\)\}/u
  );
});
