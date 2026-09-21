/**
 * @author Codex
 * @description Replace the bundled Scheduler migration assets with the current generated migration set.
 */
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = new URL('../drizzle/scheduler/', import.meta.url);
const target = new URL('../dist/assets/scheduler-migrations/', import.meta.url);
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(fileURLToPath(source), fileURLToPath(target), { recursive: true });
