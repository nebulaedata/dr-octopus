/**
 * @author Codex
 * @description Explicitly assembles fixed offline Host and Shell Node/npm resources from the verified official archive.
 */
import { executorTarget } from '../lib/platform.mjs';
executorTarget();
import { mkdir, readFile, writeFile, copyFile, lstat, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { extractZip } from '../lib/resources/archives.mjs';
import { z } from 'zod';
import { indexNodeArchive, buildNodeInventory } from '../lib/resources/node-inventory.mjs';
/**
 * Adds missing npm resources while requiring existing bytes to match; downloads occur only in this explicit command.
 */
async function assemble() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const pin = z
    .strictObject({
      version: z.literal('24.20.0'),
      url: z.url(),
      archiveSha256: z.string(),
      nodeSha256: z.string(),
    })
    .parse(JSON.parse(await readFile(join(root, 'vendor', 'browser-node.json'), 'utf8')));
  const cache = join(root, 'build', 'vendor');
  await mkdir(cache, { recursive: true });
  const archive = join(cache, 'node-v24.20.0-win-x64.zip');
  let bytes;
  try {
    bytes = await readFile(archive);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw error;
    }
    const response = await fetch(pin.url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) {
      throw new Error('Node archive download failed', { cause: error });
    }
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (createHash('sha256').update(bytes).digest('hex') !== pin.archiveSha256) {
    throw new Error('Node archive hash mismatch');
  }
  await writeFile(archive, bytes);
  const staging = join(cache, `browser-node-${randomUUID()}`);
  await extractZip(archive, staging);
  const payload = join(staging, 'node-v24.20.0-win-x64');
  if (
    createHash('sha256')
      .update(await readFile(join(payload, 'node.exe')))
      .digest('hex') !== pin.nodeSha256
  ) {
    throw new Error('Node executable hash mismatch');
  }
  const target = join(root, 'dist', 'resources', 'node');
  await mkdir(target, { recursive: true });
  if ((await realpath(target)).toLowerCase() !== resolve(target).toLowerCase()) {
    throw new Error('Node assembly target alias rejected');
  }
  const inventory = await indexNodeArchive(root);
  for (const file of inventory.files) {
    const destination = join(target, file.path);
    await mkdir(dirname(destination), { recursive: true });
    if (
      (await realpath(dirname(destination))).toLowerCase() !== resolve(dirname(destination)).toLowerCase()
    ) {
      throw new Error('Node assembly directory alias rejected');
    }
    try {
      if (file.path === '.executor-asset.json') {
        await writeFile(destination, JSON.stringify(pin), { flag: 'wx' });
      } else {
        await copyFile(join(payload, file.path), destination, constants.COPYFILE_EXCL);
      }
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
        throw error;
      }
    }
    const info = await lstat(destination);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1 ||
      info.size !== file.size ||
      createHash('sha256')
        .update(await readFile(destination))
        .digest('hex') !== file.sha256
    ) {
      throw new Error('Existing Node resource differs; assembly will not replace it');
    }
  }
  await buildNodeInventory(root);
}
void assemble().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
