/**
 * @author Codex
 * @description Resolves formal Executor project storage while preserving isolated test and explicit-instance directories.
 */
import { join } from 'node:path';

/**
 * Uses the home project directory for normal launch and never writes there from an isolated instance.
 */
export function executorProjectRoot(home: string, userData: string, isolated: boolean): string {
  return isolated ? join(userData, 'project') : join(home, '.dr-octopus', 'executor');
}
