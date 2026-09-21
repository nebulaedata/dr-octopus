/**
 * @author Codex
 * @description Publish memory migration history and the built-in recall skill with Agent builds.
 */
import { cp, mkdir } from 'node:fs/promises';
const target = new URL('../dist/assets/memory-migrations/', import.meta.url);
await mkdir(target, { recursive: true });
await cp(new URL('../drizzle/memory/', import.meta.url), target, { recursive: true });
await cp(
  new URL('../src/extensions/memory/skills/', import.meta.url),
  new URL('../dist/extensions/memory/skills/', import.meta.url),
  { recursive: true }
);
