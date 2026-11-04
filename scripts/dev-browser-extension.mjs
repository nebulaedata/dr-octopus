/**
 * @author Codex
 * @description Starts the existing Browser development entrypoint with shared contracts and the isolated Executor, or explicit extension-only mode.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { browserDevelopment } from './browser-development.mjs';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { realpath } from 'node:fs/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = process.env.npm_execpath;
if (!cli) throw new Error('Run through pnpm dev:browser-extension.');
const args = process.argv.slice(2).filter((arg) => arg !== '--');
const { values } = parseArgs({
  args,
  options: {
    'extension-only': { type: 'boolean' },
    'cleanup-registration': { type: 'boolean' },
    'workspace-key': { type: 'string' },
    browser: { type: 'string', short: 'b', default: 'chrome' },
  },
});
if (values['workspace-key'] && !values['cleanup-registration'])
  throw new Error('--workspace-key is only allowed with --cleanup-registration.');
if (!['chrome', 'edge'].includes(values.browser)) throw new Error('Use --browser chrome or edge.');
const extensionOnly = values['extension-only'];
const children = new Set();
/**
 * Starts owned processes without shell interpolation and retains their shutdown responsibility.
 */
function run(command) {
  const child = spawn(process.execPath, [cli, ...command], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
  });
  children.add(child);
  child.once('close', () => children.delete(child));
  return child;
}
/**
 * Waits for a required build and stops on failure instead of continuing with stale artifacts.
 */
function completed(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`Development command failed (${code}).`))
    );
  });
}
const dev = browserDevelopment(root);
if (values['cleanup-registration']) {
  const key = values['workspace-key'] ?? dev.key;
  if (!/^[a-f0-9]{16}$/.test(key) || values['extension-only']) throw new Error('Invalid cleanup request.');
  const windows = process.env.SystemRoot;
  if (process.platform !== 'win32' || !windows || !isAbsolute(windows))
    throw new Error('Development registration cleanup requires Windows.');
  let manifest = join(
    homedir(),
    '.dr-octopus/executor-dev',
    key,
    'electron/project/browser-host/registration/native-host.json'
  );
  try {
    manifest = await realpath(manifest);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await completed(
    spawn(
      join(windows, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        fileURLToPath(
          new URL('../apps/executor/src/installation/windows/remove-development-host.ps1', import.meta.url)
        ),
        '-WorkspaceKey',
        key,
        '-ExpectedManifest',
        manifest,
      ],
      { shell: false, windowsHide: true, stdio: 'inherit' }
    )
  );
  console.log(`Removed matching dev registrations for ${key}; profiles and data were retained.`);
  process.exit(0);
}
await completed(run(['--filter', '@octopus/shared', 'build']));
console.log(
  `[browser-dev] Host ${dev.hostName}\nRuntime target http://127.0.0.1:${dev.runtimePort}/mcp\nProfile ${dev.profile}\nExecutor data ${dev.userData}`
);
// Executor's development entrypoint owns Electron and its Vite server; IPC disconnect requests orderly cleanup.
const executor = extensionOnly
  ? null
  : spawn(
      process.execPath,
      [fileURLToPath(new URL('../apps/executor/scripts/compile/dev.mjs', import.meta.url))],
      { cwd: root, stdio: ['inherit', 'inherit', 'inherit', 'ipc'], shell: false, windowsHide: true }
    );
const require = createRequire(new URL('../apps/browser-extension/package.json', import.meta.url));
const { createServer } = await import(pathToFileURL(require.resolve('wxt')).href);
let finish;
const stopped = new Promise((resolve) => {
  finish = resolve;
});
/**
 * Requests shutdown of the owned WXT server and Executor session.
 */
function stop() {
  finish();
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
executor?.once('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
  stop();
});
executor?.once('exit', (code) => {
  if (code) {
    process.exitCode = code;
    stop();
  }
});
let server;
try {
  server = await createServer({
    root: fileURLToPath(new URL('../apps/browser-extension/', import.meta.url)),
    browser: values.browser,
    dev: {
      server: {
        host: '127.0.0.1',
        port: dev.extensionPort + (values.browser === 'edge' ? 1 : 0),
        strictPort: true,
      },
    },
  });
  await server.start();
  await stopped;
} finally {
  await server?.stop();
  if (executor?.connected) executor.send({ type: 'shutdown' });
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
}
