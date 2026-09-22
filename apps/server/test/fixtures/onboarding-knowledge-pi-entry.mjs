/**
 * @author Codex
 * @description Adds the production knowledge extension to the isolated onboarding RPC fixture.
 */
import { fileURLToPath } from 'node:url';
process.argv.push(
  '--extension',
  fileURLToPath(new URL('./onboarding-knowledge-extension.mjs', import.meta.url))
);
await import('./onboarding-pi-entry.mjs');
