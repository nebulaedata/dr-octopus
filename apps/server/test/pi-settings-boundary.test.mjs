/**
 * @author Codex
 * @description Guards the ownership boundary between the Server Pi settings adapter and the minimal Agent package.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const agentSourceIndexUrl = new URL('../../../packages/agent/src/index.ts', import.meta.url);
const agentSettingsDirectoryUrl = new URL('../../../packages/agent/src/settings/', import.meta.url);
const serverCompositionRootUrl = new URL('../src/modules/index.ts', import.meta.url);
const settingsServiceUrl = new URL('../src/modules/settings/settings.service.ts', import.meta.url);

test('Pi settings ownership remains inside the Server host boundary', () => {
  const agentSourceIndex = readFileSync(agentSourceIndexUrl, 'utf8');
  const serverCompositionRoot = readFileSync(serverCompositionRootUrl, 'utf8');
  const settingsService = readFileSync(settingsServiceUrl, 'utf8');

  assert.equal(existsSync(agentSettingsDirectoryUrl), false);
  assert.doesNotMatch(agentSourceIndex, /settings\/index/u);
  assert.match(serverCompositionRoot, /createPiSettingsStore/u);
  assert.match(settingsService, /\.\.\/\.\.\/lib\/pi-settings\/index\.js/u);
});
