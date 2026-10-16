/**
 * @author Codex
 * @description Checks the complete unpacked product inventory with private Node and saves immutable evidence; never starts Executor, Browser Host or Computer.
 */
import { open, lstat, realpath } from 'node:fs/promises';
import { writeSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, sep, dirname, basename } from 'node:path';
import { parseArgs } from 'node:util';
import { runtimeManifestPath, verifyRuntimeManifest } from '../../scripts/lib/package/runtime-manifest.mjs';
/**
 * Owns the finite read-only check and an exclusively created report; a deadline terminates only this standalone verifier.
 */
async function main() {
  const { values } = parseArgs({
    options: { product: { type: 'string' }, report: { type: 'string' } },
    allowPositionals: false,
  });
  if (!values.product || !values.report) {
    throw new Error('Provide --product and a new --report path.');
  }
  const product = resolve(values.product);
  const requestedReport = resolve(values.report);
  const reportPath = join(await realpath(dirname(requestedReport)), basename(requestedReport));
  const relation = relative(await realpath(product), reportPath);
  if (relation !== '..' && !relation.startsWith('..' + sep) && !isAbsolute(relation)) {
    throw new Error('Save evidence outside the product directory.');
  }
  const output = await open(reportPath, 'wx');
  const deadline = setTimeout(() => {
    writeSync(
      output.fd,
      JSON.stringify({
        schemaVersion: 1,
        recordedAtUtc: new Date().toISOString(),
        scope: 'unpacked-release-inventory-only',
        passed: false,
        error: 'RELEASE_INVENTORY_DEADLINE',
        publisherAuthentication: 'not-verified-unsigned-acceptance',
        acceptance: { G4: 'pending', G5: 'pending', G6: 'pending' },
      })
    );
    process.exit(1);
  }, 180000);
  try {
    let verification = null;
    let error = null;
    try {
      const manifestFile = join(product, runtimeManifestPath);
      const info = await lstat(manifestFile);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 8 * 1024 * 1024) {
        throw new Error('RELEASE_MANIFEST_INVALID');
      }
      const input = await open(manifestFile, 'r');
      let text;
      try {
        const bytes = Buffer.allocUnsafe(8 * 1024 * 1024 + 1);
        let length = 0;
        while (length < bytes.length) {
          const read = await input.read(bytes, length, bytes.length - length);
          if (!read.bytesRead) {
            break;
          }
          length += read.bytesRead;
        }
        if (length > 8 * 1024 * 1024) {
          throw new Error('RELEASE_MANIFEST_INVALID');
        }
        text = bytes.subarray(0, length).toString('utf8');
      } finally {
        await input.close();
      }
      verification = await verifyRuntimeManifest(product, JSON.parse(text));
    } catch {
      error = 'RELEASE_INVENTORY_VERIFICATION_FAILED';
      process.exitCode = 1;
    }
    clearTimeout(deadline);
    await output.writeFile(
      JSON.stringify(
        {
          schemaVersion: 1,
          recordedAtUtc: new Date().toISOString(),
          scope: 'unpacked-release-inventory-only',
          passed: !error,
          verification,
          error,
          publisherAuthentication: 'not-verified-unsigned-acceptance',
          acceptance: { G4: 'pending', G5: 'pending', G6: 'pending' },
        },
        null,
        2
      )
    );
  } finally {
    clearTimeout(deadline);
    await output.close();
  }
}
void main().catch(() => {
  console.error('Inventory verifier could not complete or create new evidence.');
  process.exitCode = 1;
});
