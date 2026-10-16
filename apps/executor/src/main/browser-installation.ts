/**
 * @author Codex
 * @description Configures the bundled current-user Browser Host and resolves finite local extension installation targets.
 */
import { execFile } from 'node:child_process';
import { access, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

/**
 * Runs the fixed bundled installer with Main-owned paths, migrating recognized product registrations.
 * @throws When setup fails or exceeds its deadline; partial registration changes may remain.
 */
export async function configureBrowserHost(
  resourceRoot: string,
  projectRoot: string,
  signal?: AbortSignal
): Promise<void> {
  const script = join(resourceRoot, 'setup/register-browser-host.ps1');
  await access(script);
  const windowsRoot = process.env.SystemRoot;
  if (process.platform !== 'win32' || !windowsRoot || !isAbsolute(windowsRoot)) {
    throw new Error('Windows setup unavailable');
  }
  await execute(
    join(windowsRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      script,
      '-Mode',
      'install',
      '-ResourceRoot',
      resourceRoot,
      '-ProjectRoot',
      projectRoot,
      '-MigrateProduct',
    ],
    { windowsHide: true, timeout: 60000, maxBuffer: 64 * 1024, signal }
  );
}

/**
 * Resolves a complete extension inside the selected bundle without allowing directory escapes.
 */
export async function browserExtensionFolder(
  root: string,
  browser: 'chrome' | 'edge' | 'chrome-mv3' | 'edge-mv3'
): Promise<string> {
  const base = await realpath(root);
  const folder = await realpath(join(base, browser));
  const inside = relative(base, folder);
  if (inside.startsWith('..') || isAbsolute(inside)) {
    throw new Error('Extension outside bundle');
  }
  await access(join(folder, 'manifest.json'));
  return folder;
}
