/**
 * @author Codex
 * @description Exercises the fixed private Pillow capture path, startup dependencies and target rejection with synthetic pixels only.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('fixed Pillow capture preserves bounds and rejects stale targets without importing GPU or UIA backends', async () => {
  const result = await promisify(execFile)(
    fileURLToPath(new URL('../../dist/resources/computer/python.exe', import.meta.url)),
    ['-I', '-B', fileURLToPath(new URL('../fixtures/computer-capture.py', import.meta.url))],
    { windowsHide: true, env: { SystemRoot: process.env.SystemRoot }, timeout: 15000 }
  );
  assert.match(result.stderr, /Ran 7 tests/);
  assert.match(result.stderr, /OK/);
  assert.equal(result.stdout, '');
});
