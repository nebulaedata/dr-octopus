/**
 * @author Codex
 * @description Verifies the Server Pi adapter drives installed 0.84.3 login and logout contracts in an isolated directory.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPiSettingsStore } from '../dist/infrastructure/pi-settings/index.js';

test('Pi ModelRuntime persists and removes an API Key through the Server interaction port', async () => {
  const agentDir = await mkdtemp(join(tmpdir(), 'octopus-settings-auth-'));
  const settings = createPiSettingsStore({ agentDir });
  const prompts = [];
  // Pi resolves anthropic credentials from stored auth, then ANTHROPIC_AUTH_TOKEN,
  // ANTHROPIC_OAUTH_TOKEN and ANTHROPIC_API_KEY; isolating one variable is not enough.
  const AUTH_ENV_VARS = ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'];
  const previousEnv = Object.fromEntries(AUTH_ENV_VARS.map((name) => [name, process.env[name]]));
  for (const name of AUTH_ENV_VARS) {
    delete process.env[name];
  }
  try {
    await settings.loginProvider('anthropic', 'api_key', {
      signal: new AbortController().signal,
      async prompt(prompt) {
        prompts.push(prompt.type);
        return 'test-api-key';
      },
      notify() {},
    });
    const provider = (await settings.listProviders()).find((candidate) => candidate.id === 'anthropic');
    assert.deepEqual(prompts, ['secret']);
    assert.equal(provider.auth.configured, true);
    assert.equal(provider.auth.activeMethod, 'api_key');
    assert.equal(provider.auth.source, 'stored');

    await settings.logoutProvider('anthropic');
    const resetProvider = (await settings.listProviders()).find((candidate) => candidate.id === 'anthropic');
    assert.equal(resetProvider.auth.configured, false);
    assert.equal(resetProvider.auth.activeMethod, undefined);
    assert.equal(resetProvider.auth.source, undefined);
  } finally {
    for (const name of AUTH_ENV_VARS) {
      if (previousEnv[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = previousEnv[name];
      }
    }
    await rm(agentDir, { recursive: true, force: true });
  }
});
