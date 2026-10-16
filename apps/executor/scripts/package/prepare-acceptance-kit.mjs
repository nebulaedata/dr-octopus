/**
 * @author Codex
 * @description Emits a standalone acceptance companion without changing installer or ZIP bytes; the probe uses the product's fixed private Node and existing dependency licenses.
 */
import { build } from 'esbuild';
import { executorTarget } from '../lib/platform.mjs';
import '../lib/compile/application-api.mjs';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
const root = fileURLToPath(new URL('../../', import.meta.url));
/**
 * Builds a new companion directory; existing reports, kits and product artifacts remain intact.
 */
export async function prepareAcceptanceKit(output) {
  executorTarget();
  const kit = join(output, `acceptance-kit-${randomUUID()}`);
  await mkdir(kit);
  await build({
    absWorkingDir: root,
    entryPoints: ['test/packaging/network-probe.mjs'],
    outfile: join(kit, 'network-probe.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    sourcemap: false,
  });
  const digest = createHash('sha256')
    .update(await readFile(join(kit, 'network-probe.cjs')))
    .digest('hex');
  await writeFile(join(kit, 'network-probe.sha256'), digest);
  await build({
    absWorkingDir: root,
    entryPoints: ['test/packaging/verify-runtime-manifest.mjs'],
    outfile: join(kit, 'verify-runtime-manifest.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    sourcemap: false,
  });
  await writeFile(
    join(kit, 'verify-runtime-manifest.sha256'),
    createHash('sha256')
      .update(await readFile(join(kit, 'verify-runtime-manifest.cjs')))
      .digest('hex')
  );
  await build({
    absWorkingDir: root,
    entryPoints: ['src/maintenance/data-backup.ts'],
    outfile: join(kit, 'data-backup.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    sourcemap: false,
  });
  await writeFile(
    join(kit, 'data-backup.sha256'),
    createHash('sha256')
      .update(await readFile(join(kit, 'data-backup.cjs')))
      .digest('hex')
  );
  for (const name of [
    'offline-preflight.ps1',
    'network-probe.ps1',
    'verify-runtime-manifest.ps1',
    'data-backup.ps1',
    'diagnose-browser-host.ps1',
    'record-acceptance.ps1',
  ]) {
    await cp(join(root, 'test/packaging', name), join(kit, name), { errorOnExist: true, force: false });
  }
  await cp(join(root, '../../docs/architecture/executor-delivery.md'), join(kit, 'README.md'));
  await cp(join(root, '../../docs/architecture/executor-computer.md'), join(kit, 'COMPUTER-ACCEPTANCE.md'));
  return kit;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = process.argv[2];
  if (!output || process.argv.length !== 3) {
    throw new Error('Provide exactly one existing artifact directory.');
  }
  console.log(await prepareAcceptanceKit(resolve(output)));
}
