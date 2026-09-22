/**
 * @author Codex
 * @description Runs the installed Pi RPC implementation with isolated settings and without automatic resource discovery or built-in tools.
 */
const args = process.argv.slice(2);
const workspaceIndex = args.indexOf('--workspace');
if (workspaceIndex >= 0) args.splice(workspaceIndex, 2);
process.argv = [
  ...process.argv.slice(0, 2),
  ...args,
  '--no-extensions',
  '--no-skills',
  '--no-prompt-templates',
  '--no-themes',
  args.includes('--extension') ? '--no-builtin-tools' : '--no-tools',
];
await import('@earendil-works/pi-coding-agent/rpc-entry');
