/**
 * @author Codex
 * @description Runs isolated Python guarded-input fault tests with the fixed private interpreter, never a real user input sink.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const run = promisify(execFile);

test('private Python input accounting preserves user state, pairs cleanup and never replays partial actions', async () => {
  const python = fileURLToPath(new URL('../../dist/resources/computer/python.exe', import.meta.url));
  const fixture = fileURLToPath(new URL('../fixtures/computer-input-faults.py', import.meta.url));
  const source = fileURLToPath(new URL('../../vendor/computer/desktop.py', import.meta.url));
  const result = await run(python, ['-I', '-B', fixture, source], {
    windowsHide: true,
    env: { SystemRoot: process.env.SystemRoot },
    timeout: 15000,
  });
  assert.match(result.stderr, /Ran 8 tests/);
  assert.match(result.stderr, /OK/);
  assert.equal(result.stdout, '');
});
