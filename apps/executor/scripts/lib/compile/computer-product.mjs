/**
 * @author Codex
 * @description Publishes the private guarded backend and generates its schemas from the Runtime contract during explicit assembly or offline builds.
 */
import { applicationApi } from './application-api.mjs';
const { backendSchemas } = applicationApi;
import { copyFile, mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * Copies trusted source files into an already assembled interpreter; never acquires runtime dependencies.
 */
export async function publishComputerProduct(root, resources) {
  const client = join(resources, 'Lib/site-packages/comtypes/client/__init__.py');
  const source = await readFile(client);
  const digest = createHash('sha256').update(source).digest('hex');
  if (digest === '2a49a261afd7c0a2c9723c45a8503ac62b7be15766d36df58542400ef2fb80b2') {
    const patched = Buffer.from(
      source.toString('utf8').replace('gen_dir = _find_gen_dir()', 'gen_dir = None')
    );
    if (
      createHash('sha256').update(patched).digest('hex') !==
      'b3c7904a63520f3de0dbc7957b3d5924fff46b199b085dae0dc5ff2c1018aa6b'
    ) {
      throw new Error('COMPUTER_COMTYPES_PATCH_MISMATCH');
    }
    await writeFile(client, patched);
  } else if (digest !== 'b3c7904a63520f3de0dbc7957b3d5924fff46b199b085dae0dc5ff2c1018aa6b') {
    throw new Error('COMPUTER_COMTYPES_SOURCE_MISMATCH');
  }
  const product = join(resources, 'product');
  await mkdir(product, { recursive: true });
  for (const name of ['desktop.py', 'server.py']) {
    await copyFile(join(root, 'vendor', 'computer', name), join(product, name));
  }
  const schemas = Object.fromEntries(
    Object.entries(backendSchemas).map(([name, schema]) => [
      name,
      z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }),
    ])
  );
  await writeFile(join(product, 'schemas.json'), JSON.stringify(schemas, null, 2) + '\n');
}
