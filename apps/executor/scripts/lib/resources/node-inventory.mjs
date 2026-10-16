/**
 * @author Codex
 * @description Builds the private Node/npm inventory only from verified fixed archive bytes, never from an installed tree.
 */
import { applicationApi } from '../compile/application-api.mjs';
const { nodeInventorySchema } = applicationApi;
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { indexNode } from './archives.mjs';

import { z } from 'zod';

export const nodePinSchema = z.strictObject({
  version: z.literal('24.20.0'),
  url: z.url(),
  archiveSha256: z.string().regex(/^[a-f0-9]{64}$/),
  nodeSha256: z.string().regex(/^[a-f0-9]{64}$/),
});
/**
 * Requires the offline verified cache, indexes upstream npm and adds the fixed assembly marker.
 */
export async function indexNodeArchive(root) {
  const pin = nodePinSchema.parse(JSON.parse(await readFile(join(root, 'vendor/browser-node.json'), 'utf8')));
  const archive = join(root, 'build/vendor/node-v24.20.0-win-x64.zip');
  if (
    createHash('sha256')
      .update(await readFile(archive))
      .digest('hex') !== pin.archiveSha256
  ) {
    throw new Error('NODE_ARCHIVE_HASH_MISMATCH');
  }
  const files = z.array(nodeInventorySchema.shape.files.element).parse(await indexNode(archive));
  const marker = Buffer.from(JSON.stringify(pin));
  files.push({
    path: '.executor-asset.json',
    size: marker.length,
    sha256: createHash('sha256').update(marker).digest('hex'),
  });
  const inventory = nodeInventorySchema.parse({
    version: 1,
    nodeVersion: pin.version,
    npmVersion: '11.19.0',
    files,
  });
  if (inventory.files.find((file) => file.path === 'node.exe')?.sha256 !== pin.nodeSha256) {
    throw new Error('NODE_EXECUTABLE_ARCHIVE_MISMATCH');
  }
  inventory.files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return inventory;
}
/**
 * Publishes bytes anchored in the compiled Runtime and a separate build-only test anchor; no download occurs.
 */
export async function buildNodeInventory(root) {
  const bytes = Buffer.from(JSON.stringify(await indexNodeArchive(root)));
  const digest = createHash('sha256').update(bytes).digest('hex');
  await mkdir(join(root, 'dist'), { recursive: true });
  await writeFile(join(root, 'dist/node-resources.json'), bytes);
  await writeFile(join(root, 'build/node-resources.hash'), digest);
  return digest;
}
