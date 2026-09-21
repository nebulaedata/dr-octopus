/**
 * @author Codex
 * @description Verifies toolbar slash-command insertion uses the same boundary contract as menu selection.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { formatCommandInsertion } from '../src/components/AgentComposerEditor/command-insertion.ts';

test('formats a goal command for empty and existing Composer drafts', () => {
  assert.equal(formatCommandInsertion('goal', false), '/goal ');
  assert.equal(formatCommandInsertion('goal', true), ' /goal ');
});

test('renders the goal shortcut immediately after the workspace mention button', () => {
  const source = readFileSync(new URL('../src/features/session/Composer.tsx', import.meta.url), 'utf8');
  const mention = source.indexOf("'session.composer.mentionTooltip'");
  const goal = source.indexOf("insertCommand('goal')");
  const workMode = source.indexOf('<WorkModeSelect');

  assert.ok(mention >= 0);
  assert.ok(goal > mention);
  assert.ok(workMode > goal);
  assert.match(source, /editorRef\.current\?\.insertCommand\('goal'\)/);
});

test('routes the enabled settings command into the existing masked Settings dialog', () => {
  const source = readFileSync(new URL('../src/features/session/Composer.tsx', import.meta.url), 'utf8');

  assert.match(source, /case 'settings':[\s\S]*?settings: \{ path: '\/settings\/model-providers' \}/u);
  assert.match(source, /case 'settings':[\s\S]*?mask: \{[\s\S]*?to: '\/settings\/model-providers'/u);
});
