/**
 * @author Codex
 * @description Collects exact thrown error messages from Server and agent-core sources for catalog drift assertions.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const THROWN_MESSAGE = /throw new [A-Za-z]*Error\('([A-Z_]+)', '((?:[^'\\]|\\.)*)'/g;

/**
 * Walks Server and agent-core sources for coded throws carrying literal messages.
 *
 * @returns Array of `{ code, message }` pairs in source order.
 */
export function collectThrownPairs() {
  const pairs = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (path.endsWith('.ts')) {
        for (const match of readFileSync(path, 'utf8').matchAll(THROWN_MESSAGE)) {
          pairs.push({ code: match[1], message: match[2] });
        }
      }
    }
  };
  walk(join(repoRoot, 'apps/server/src'));
  walk(join(repoRoot, 'packages/agent/src'));
  return pairs;
}

/**
 * Walks Server and agent-core sources for literal messages carried by coded throws.
 *
 * @returns Set of exact source message strings eligible for site-variant matching.
 */
export function collectThrownMessages() {
  return new Set(collectThrownPairs().map((pair) => pair.message));
}
