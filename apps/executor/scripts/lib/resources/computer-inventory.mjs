/**
 * @author Codex
 * @description Derives an offline Computer inventory from verified archive bytes plus trusted product sources and the freshly compiled supervisor.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { indexComputer } from './archives.mjs';
import {
  readComputerPin,
  computerConfigurationFiles,
  computerInitializationFile,
} from '../compile/computer-configuration.mjs';

import { computerInventorySchema } from './computer-manifest.mjs';

/**
 * Hashes explicit archive inputs before indexing; installed runtime modifications cannot acquire a new trusted digest during build.
 */
export async function buildComputerInventory(root) {
  const pin = await readComputerPin(root);
  const cache = join(root, 'build/vendor/computer');
  const archives = {
    python: join(cache, 'python-3.14.0-embed-amd64.zip'),
    wheels: pin.wheels.map((wheel) => join(cache, wheel.filename)),
  };
  const assets = [
    { ...pin.python, path: archives.python },
    ...pin.wheels.map((wheel, index) => ({ ...wheel, path: archives.wheels[index] })),
  ];
  for (const asset of assets) {
    if (
      createHash('sha256')
        .update(await readFile(asset.path))
        .digest('hex') !== asset.sha256
    ) {
      throw new Error('COMPUTER_ARCHIVE_HASH_MISMATCH');
    }
  }
  await mkdir(cache, { recursive: true });
  const files = await indexComputer(archives);
  files.push({
    ...computerInitializationFile,
    path: 'resources/computer/' + computerInitializationFile.path,
  });
  for (const [path, bytes] of Object.entries(await computerConfigurationFiles(root, pin))) {
    files.push({
      path: 'resources/computer/' + path,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  const binary = await readFile(join(root, 'dist/native/computer-supervisor.exe'));
  files.push({
    path: 'native/computer-supervisor.exe',
    size: binary.length,
    sha256: createHash('sha256').update(binary).digest('hex'),
  });
  const inventory = computerInventorySchema.parse({ version: 1, files });
  inventory.files.sort((a, b) => a.path.localeCompare(b.path));
  const bytes = Buffer.from(JSON.stringify(inventory));
  await writeFile(join(root, 'dist/computer-resources.json'), bytes);
}
