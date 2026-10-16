/**
 * @author Codex
 * @description Explicitly assembles pinned Python and hashed Windows-MCP wheels offline from verified cache, never at product startup.
 */
import { executorTarget } from '../lib/platform.mjs';
executorTarget();
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { extractComputer } from '../lib/resources/archives.mjs';
import { computerManifestSchema } from '../lib/resources/computer-manifest.mjs';
import { randomUUID } from 'node:crypto';
import { publishComputerProduct } from '../lib/compile/computer-product.mjs';
/**
 * Downloads only fixed official assets during explicit assembly, then verifies bytes before writing or extracting.
 */
async function acquire(input, path) {
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') {
      throw error;
    }
    const url = new URL(input.url);
    if (url.protocol !== 'https:' || !['www.python.org', 'files.pythonhosted.org'].includes(url.hostname)) {
      throw new Error('Unapproved resource origin', { cause: error });
    }
    const response = await fetch(url, { signal: AbortSignal.timeout(180000), redirect: 'error' });
    if (!response.ok) {
      throw new Error('Computer resource download failed', { cause: error });
    }
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (createHash('sha256').update(bytes).digest('hex') !== input.sha256) {
    throw new Error('Computer resource hash mismatch');
  }
  await writeFile(path, bytes);
}
/**
 * Publishes a new resource directory only after all verified archives are expanded; existing resources are never overwritten.
 */
async function assemble() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const pin = computerManifestSchema.parse(
    JSON.parse(await readFile(join(root, 'vendor', 'windows-mcp.json'), 'utf8'))
  );
  const cache = join(root, 'build', 'vendor', 'computer');
  await mkdir(cache, { recursive: true });
  const python = join(cache, 'python-3.14.0-embed-amd64.zip');
  await acquire(pin.python, python);
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < pin.wheels.length) {
        const wheel = pin.wheels[next++];
        await acquire(wheel, join(cache, wheel.filename));
      }
    })
  );
  const staging = join(cache, 'staging-' + randomUUID());
  await extractComputer({ python, wheels: pin.wheels.map((wheel) => join(cache, wheel.filename)) }, staging);
  await writeFile(
    join(staging, 'python314._pth'),
    'python314.zip\r\n.\r\nLib/site-packages\r\nimport site\r\n'
  );
  await publishComputerProduct(root, staging);
  await writeFile(join(staging, '.executor-asset.json'), JSON.stringify(pin));
  await mkdir(join(root, 'dist', 'resources'), { recursive: true });
  await rename(staging, join(root, 'dist', 'resources', 'computer'));
  console.log(
    'Pinned Computer resources assembled; desktop control remains unavailable until guarded backend verification.'
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void assemble().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
