/**
 * @author Codex
 * @description Verifies public Agent imports keep terminal-only dependencies lazy.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('public Agent imports and silent helpers do not load terminal UI', () => {
  const entry = new URL('../dist/index.js', import.meta.url).href;
  const script = `
    import { registerHooks } from 'node:module';
    registerHooks({ resolve(specifier, context, next) {
      if (specifier === 'oh-my-logo' || /terminal-ui\\.js$/.test(specifier)) throw new Error('Unexpected terminal dependency: ' + specifier);
      return next(specifier, context);
    }});
    const agent = await import(${JSON.stringify(entry)});
    if (await agent.renderStartupLogo(['--mode', 'rpc'])) throw new Error('RPC rendered a logo');
    if (await agent.runInteractiveInstall(async () => 42, { silent: true }) !== 42) throw new Error('Silent install failed');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr);
});
