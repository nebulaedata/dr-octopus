/**
 * @author Codex
 * @description Bundle generated knowledge migrations for the isolated daemon entry.
 */
import { cp, mkdir } from 'node:fs/promises';

const source = new URL('../drizzle/knowledge/', import.meta.url);
const target = new URL('../dist/assets/knowledge-migrations/', import.meta.url);
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });

await cp(
  new URL('../src/extensions/knowledge/skills/', import.meta.url),
  new URL('../dist/extensions/knowledge/skills/', import.meta.url),
  { recursive: true }
);
