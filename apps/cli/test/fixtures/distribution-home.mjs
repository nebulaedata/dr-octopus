/**
 * @author Codex
 * @description Isolates packaged CLI runtime installation from the developer's real OS-user data directory.
 */
import { mock } from 'node:test';
import * as os from 'node:os';
const { default: original, ...named } = os;
/**
 * Preserves real OS properties while assigning a test-owned home to runtime discovery.
 */
const userInfo = () => ({ ...os.userInfo(), homedir: process.env.OCTOPUS_TEST_HOME });
mock.module('node:os', { namedExports: { ...named, userInfo }, defaultExport: { ...original, userInfo } });
if (process.env.OCTOPUS_TEST_TTY === '1') {
  Object.defineProperty(process.stdin, 'isTTY', { value: true });
  Object.defineProperty(process.stderr, 'isTTY', { value: true });
}
