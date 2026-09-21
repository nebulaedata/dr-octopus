/**
 * @author Codex
 * @description Copy Permission migrations and bundled configuration assets into the Agent distribution.
 */
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = new URL('../drizzle/permission/', import.meta.url);
const target = new URL('../dist/assets/permission-migrations/', import.meta.url);
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(fileURLToPath(source), fileURLToPath(target), { recursive: true });

await cp(
  new URL('../src/extensions/permission-system/config/', import.meta.url),
  new URL('../dist/extensions/permission-system/config/', import.meta.url),
  { recursive: true }
);
