/**
 * @author Codex
 * @description Loads the build-only archive-derived anchor for source tests; production uses the compiled Runtime constant.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { NodeResources } from '../../src/runtime/basic/node-resources.ts';

const owners = new Map();

/**
 * Shares immutable verified resources within one fixture process without reading a disk manifest as its own trust anchor.
 */
export async function testNodeResources(root, native) {
  if (!owners.has(root)) {
    const anchor = fileURLToPath(new URL('../../build/node-resources.hash', import.meta.url));
    owners.set(
      root,
      readFile(anchor, 'utf8').then((hash) => NodeResources.open(root, native, hash))
    );
  }
  return owners.get(root);
}
