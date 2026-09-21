/**
 * @author Codex
 * @description Builds the Gateway host separately, preserving Server and native package runtime boundaries.
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { gateway: fileURLToPath(new URL('./src/gateway/entry.ts', import.meta.url)) },
  outDir: fileURLToPath(new URL('./dist/', import.meta.url)),
  clean: false,
  format: 'esm',
  outExtensions: () => ({ js: '.mjs' }),
  deps: { neverBundle: ['@octopus/server', 'koffi'] },
  dts: false,
  sourcemap: true,
});
