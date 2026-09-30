/**
 * @author Codex
 * @description Publishes the built-in image generation skill alongside its compiled extension.
 */
import { cp } from 'node:fs/promises';

await cp(
  new URL('../src/extensions/imagegen/skills/', import.meta.url),
  new URL('../dist/extensions/imagegen/skills/', import.meta.url),
  { recursive: true }
);
