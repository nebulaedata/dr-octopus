/**
 * @author Codex
 * @description Derives an offline Computer inventory from verified archive bytes plus trusted product sources and the freshly compiled supervisor.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { indexComputer } from './archives.mjs';

import { computerInventorySchema, computerManifestSchema } from './computer-manifest.mjs';

/**
 * Hashes explicit archive inputs before indexing; installed runtime modifications cannot acquire a new trusted digest during build.
 */
export async function buildComputerInventory(root) {
  const pin = computerManifestSchema.parse(
    JSON.parse(await readFile(join(root, 'vendor/windows-mcp.json'), 'utf8'))
  );
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
  for (const path of [
    'python314._pth',
    '.executor-asset.json',
    'product/desktop.py',
    'product/server.py',
    'product/schemas.json',
  ]) {
    const bytes =
      path === 'python314._pth'
        ? Buffer.from('python314.zip\r\n.\r\nLib/site-packages\r\nimport site\r\n')
        : path === '.executor-asset.json'
          ? Buffer.from(JSON.stringify(pin))
          : await readFile(join(root, 'dist/resources/computer', path));
    files.push({
      path: 'resources/computer/' + path,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  const clientPath = 'resources/computer/Lib/site-packages/comtypes/client/__init__.py';
  const clientEntry = files.find(
    (file) => file && typeof file === 'object' && 'path' in file && file.path === clientPath
  );
  if (
    !clientEntry ||
    typeof clientEntry !== 'object' ||
    !('sha256' in clientEntry) ||
    clientEntry.sha256 !== '2a49a261afd7c0a2c9723c45a8503ac62b7be15766d36df58542400ef2fb80b2'
  ) {
    throw new Error('COMPUTER_COMTYPES_ARCHIVE_MISMATCH');
  }
  clientEntry.sha256 = 'b3c7904a63520f3de0dbc7957b3d5924fff46b199b085dae0dc5ff2c1018aa6b';
  if (!('size' in clientEntry) || typeof clientEntry.size !== 'number') {
    throw new Error('COMPUTER_COMTYPES_ARCHIVE_MISMATCH');
  }
  clientEntry.size -= 'gen_dir = _find_gen_dir()'.length - 'gen_dir = None'.length;
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
