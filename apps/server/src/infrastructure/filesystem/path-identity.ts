/**
 * @author Codex
 * @description Resolves filesystem identity using platform-specific canonical path semantics.
 */
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Resolves an existing filesystem path to its canonical absolute identity.
 */
export async function canonicalizePath(path: string): Promise<string> {
  return realpath(resolve(path));
}

/**
 * Compares canonical paths with platform-appropriate case semantics.
 */
export function areCanonicalPathsEqual(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.toLocaleLowerCase('en-US') === right.toLocaleLowerCase('en-US')
    : left === right;
}
