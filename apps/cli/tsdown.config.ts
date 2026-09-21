/**
 * @author Codex
 * @description Bundles the complete management CLI so diagnostics and installation work without node_modules.
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { cli: fileURLToPath(new URL('./src/index.ts', import.meta.url)) },
  outDir: fileURLToPath(new URL('./dist/', import.meta.url)),
  format: 'esm',
  outExtensions: () => ({ js: '.mjs' }),
  deps: { alwaysBundle: [/.*/] },
  dts: false,
  sourcemap: false,
  minify: true,
});
