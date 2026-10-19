/**
 * @author Codex
 * @description Verifies that the product contract and bundled runtime compile the version from the Executor manifest.
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import test from 'node:test';
import { executorProduct } from '../src/contracts/product.ts';

test('source and browser/node bundles follow a changed manifest without runtime metadata reads', async (t) => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(executorProduct.version, manifest.version);
  const root = await mkdtemp(join(tmpdir(), 'octopus-product-version-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'src/contracts'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ ...manifest, version: '0.9.7' }));
  await writeFile(
    join(root, 'src/contracts/product.ts'),
    await readFile(new URL('../src/contracts/product.ts', import.meta.url))
  );
  for (const platform of ['node', 'browser']) {
    const result = await build({
      absWorkingDir: root,
      entryPoints: ['src/contracts/product.ts'],
      bundle: true,
      platform,
      format: 'esm',
      write: false,
    });
    const code = result.outputFiles[0].text;
    assert.doesNotMatch(code, /(?:import|require)\s*\(?[^\n]*package\.json/);
    const bundled = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
    assert.equal(bundled.executorProduct.version, '0.9.7');
  }
});
