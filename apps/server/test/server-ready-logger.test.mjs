/**
 * @author Codex
 * @description Verifies that Server startup URLs follow Vite's repeated address-label format.
 */

import assert from 'node:assert/strict';
import { stripVTControlCharacters } from 'node:util';
import test from 'node:test';
import { createNetworkUrlLines } from '../dist/infrastructure/logging/server-ready-logger.js';

test('repeats the Vite-style Network label for every discovered address', () => {
  const lines = createNetworkUrlLines(['http://192.168.0.80:3000/', 'http://198.18.0.1:3000/']).map((line) =>
    stripVTControlCharacters(line)
  );

  assert.deepEqual(lines, [
    '  ➜  Network: http://192.168.0.80:3000/',
    '  ➜  Network: http://198.18.0.1:3000/',
  ]);
});
