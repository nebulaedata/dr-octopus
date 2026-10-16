/**
 * @author Codex
 * @description Explicitly assembles pinned upstream search tools and licenses without product-time downloads.
 */
import { executorTarget } from '../lib/platform.mjs';
import { extractZip } from '../lib/resources/archives.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
const assetSchema = z.strictObject({
  version: z.string(),
  asset: z.string(),
  url: z.url(),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
/**
 * Verifies archives before extraction into fresh staging and retains the entire upstream license tree.
 */
export async function assembleSearch() {
  executorTarget();
  const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
  const manifest = z
    .strictObject({ rg: assetSchema, fd: assetSchema })
    .parse(JSON.parse(await readFile(join(root, 'vendor', 'search-tools.json'), 'utf8')));
  const cache = join(root, 'build', 'vendor');
  await mkdir(cache, { recursive: true });
  const staging = join(cache, `search-${randomUUID()}`);
  await mkdir(staging);
  const pins = {};
  for (const [name, asset] of Object.entries(manifest)) {
    const archive = join(cache, asset.asset);
    let bytes;
    try {
      bytes = await readFile(archive);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        throw new Error('Search asset cache could not be read.', { cause: error });
      }
      const response = await fetch(asset.url, { signal: AbortSignal.timeout(180000) });
      if (!response.ok) {
        throw new Error(`Search asset download failed (${response.status}).`, { cause: error });
      }
      bytes = Buffer.from(await response.arrayBuffer());
    }
    if (bytes.length !== asset.size || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
      throw new Error('Search upstream archive hash mismatch.');
    }
    await writeFile(archive, bytes);
    const extracted = join(staging, name);
    await extractZip(archive, extracted);
    const directories = await readdir(extracted);
    if (directories.length !== 1) {
      throw new Error('Unexpected upstream archive layout.');
    }
    const payload = join(extracted, directories[0]);
    pins[name] = createHash('sha256')
      .update(await readFile(join(payload, `${name}.exe`)))
      .digest('hex');
    await cp(payload, join(staging, `payload-${name}`), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
  }
  const target = join(root, 'dist', 'resources', 'search');
  await mkdir(target); // Refuse to overwrite an assembled resource set.
  for (const name of ['rg', 'fd']) {
    await cp(join(staging, `payload-${name}`), join(target, name), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
  }
  await writeFile(join(target, '.executor-asset.json'), JSON.stringify({ manifest, pins }));
  console.log('Assembled pinned ripgrep 15.2.0 and fd 10.5.0 for Windows x64.');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await assembleSearch();
}
