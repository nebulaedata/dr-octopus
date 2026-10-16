/**
 * @author Codex
 * @description Builds both browser targets and then collects licenses, stopping immediately if any engineering step fails.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const cli = process.env.npm_execpath;
if (!cli) {
  throw new Error('Run extension builds through pnpm.');
}
/**
 * Runs a JavaScript CLI with literal arguments and streams its output; no shell or TS execution hook is used.
 */
async function run(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
      shell: false,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error('Extension build step failed: ' + (signal ?? code)));
      }
    });
  });
}
await run([cli, 'exec', 'wxt', 'build']);
await run([cli, 'exec', 'wxt', 'build', '-b', 'edge']);
await run([join(root, 'scripts/licenses.mjs')]);
