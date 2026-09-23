/**
 * @author Codex
 * @description Verifies Host command ownership and Pi command normalization for the Web Composer catalog.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionCommandCatalog } from '../dist/modules/sessions/sessions.service.js';

test('command catalog exposes supported Host commands and only pending Web placeholders', () => {
  const catalog = createSessionCommandCatalog([]);
  assert.deepEqual(
    catalog.commands.map((command) => command.name),
    ['compact', 'model', 'new', 'fork', 'clone', 'name', 'export', 'settings', 'hotkeys']
  );
  assert.equal(
    catalog.commands.some((command) => command.name === 'copy'),
    false
  );
  assert.deepEqual(
    catalog.commands.find((command) => command.name === 'settings'),
    {
      name: 'settings',
      description: 'Open Web settings',
      source: 'host',
      execution: 'client',
      enabled: true,
    }
  );
  assert.equal(catalog.commands.find((command) => command.name === 'hotkeys')?.enabled, false);
});

test('command catalog normalizes Pi commands and preserves Host ownership on collisions', () => {
  const catalog = createSessionCommandCatalog([
    { name: 'model', description: 'Extension collision', source: 'extension' },
    { name: 'plan', description: 'Plan mode', source: 'extension' },
    { name: 'review', description: 'Review prompt', source: 'prompt' },
    { name: 'skill:architecture', description: 'Architecture skill', source: 'skill' },
  ]);
  assert.equal(catalog.commands.filter((command) => command.name === 'model').length, 1);
  assert.deepEqual(
    catalog.commands.slice(-3).map((command) => ({
      name: command.name,
      source: command.source,
      execution: command.execution,
      enabled: command.enabled,
    })),
    [
      { name: 'plan', source: 'extension', execution: 'prompt', enabled: true },
      { name: 'review', source: 'prompt', execution: 'prompt', enabled: true },
      { name: 'skill:architecture', source: 'skill', execution: 'prompt', enabled: true },
    ]
  );
});
