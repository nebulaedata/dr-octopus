/**
 * @author Codex
 * @description Resolves bundled PDF.js resources for offline text extraction and rendering in Node workers.
 */
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

/**
 * Uses package-relative resources, independent of the constrained worker cwd.
 * PDF.js requires forward slashes and a trailing slash even on Windows.
 */
export function pdfResourceOptions(): {
  cMapUrl: string;
  cMapPacked: boolean;
  standardFontDataUrl: string;
  wasmUrl: string;
} {
  const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')).replaceAll(
    '\\',
    '/'
  );
  return {
    cMapUrl: `${root}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${root}/standard_fonts/`,
    wasmUrl: `${root}/wasm/`,
  };
}
