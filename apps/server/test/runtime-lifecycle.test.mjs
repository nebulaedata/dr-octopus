/**
 * @author Codex
 * @description Runs isolated Server lifecycle regressions with deterministic infrastructure replacements.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('Public Server runtime starts, cancels and cleans up without process management', async () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = await promisify(execFile)(
    process.execPath,
    [
      '--experimental-test-module-mocks',
      '--test',
      '--test-reporter=tap',
      fileURLToPath(new URL('./fixtures/runtime-lifecycle.mjs', import.meta.url)),
    ],
    { timeout: 20_000, env }
  );
  assert.match(result.stdout, /# fail 0/);
});
