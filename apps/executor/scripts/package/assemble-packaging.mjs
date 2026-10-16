/**
 * @author Codex
 * @description Explicitly acquires the pinned builder's NSIS and resource-editor tools before offline packaging.
 */
import { executorTarget } from '../lib/platform.mjs';
executorTarget();
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { packageLicenses } from '../lib/package/package-licenses.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('electron-builder'));
const tools = builderRequire('app-builder-lib/out/toolsets/windows.js');
const archiveTools = builderRequire('app-builder-lib/out/toolsets/7zip.js');
/**
 * Records exact local tool files so normal packaging refuses changed or missing caches rather than downloading.
 */
async function inventory(directory, prefix = '') {
  const files = [];
  for (const item of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const path = join(prefix, item.name);
    if (item.isDirectory()) {
      files.push(...(await inventory(directory, path)));
    } else if (item.isFile()) {
      files.push({
        path,
        sha256: createHash('sha256')
          .update(await readFile(join(directory, path)))
          .digest('hex'),
      });
    } else {
      throw new Error('Packaging tool cache must contain only regular files and directories.');
    }
  }
  return files;
}
/**
 * Only this development assembly command permits acquisition; installed applications never use these tools.
 */
async function assemble() {
  await packageLicenses(root, join(root, 'build/production-licenses'));
  const nsis = dirname((await tools.getMakeNsisPath('1.2.1')).path);
  const rcedit = dirname((await tools.getRceditBundle('1.1.0')).x64);
  const sevenZip = dirname(await archiveTools.getPath7za());
  const records = [];
  for (const [name, directory] of Object.entries({ nsis, rcedit, sevenZip })) {
    records.push({ name, directory, files: await inventory(directory) });
  }
  await mkdir(join(root, 'build'), { recursive: true });
  await writeFile(
    join(root, 'build/packaging-tools.json'),
    JSON.stringify({ builder: '26.15.3', records }, null, 2)
  );
}
await assemble();
