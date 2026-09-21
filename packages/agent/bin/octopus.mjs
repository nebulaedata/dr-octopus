#!/usr/bin/env node
/**
 * @author Codex
 * @description Provides an install-time CLI entry and loads the built Agent CLI when available.
 */
import { existsSync } from 'node:fs';
import process from 'node:process';

const entry = new URL('../dist/bin/octopus.js', import.meta.url);

if (!existsSync(entry)) {
  process.stderr.write(
    'octopus: Agent CLI is not built. Run "pnpm exec turbo run build --filter=@octopus/agent" from the repository root.\n'
  );
  process.exitCode = 1;
} else {
  await import(entry.href);
}
