/**
 * @author Codex
 * @description Verifies that the internal RPC launcher resolves the packaged Octopus CLI without relying on an exported package subpath.
 */

import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';
import { resolveOctopusCliPath } from '../dist/cli/path.js';

test('resolves the built CLI entry from the current package layout', async () => {
  const cliPath = resolveOctopusCliPath();

  await access(cliPath);
  assert.match(cliPath.replaceAll('\\', '/'), /\/dist\/bin\/octopus\.js$/u);
});
