/**
 * @author Codex
 * @description Selects the fixed system Shell explicitly per platform and probes Windows PowerShell without inheriting user startup configuration.
 */
import { execFile } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { dirname, join, win32 } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
export type ShellStatus = {
  kind: 'powershell';
  version: string | null;
  available: boolean;
  code?: 'SHELL_NOT_FOUND' | 'SHELL_VERSION_UNSUPPORTED' | 'SHELL_PROBE_FAILED';
};
export type SystemShell = { executable: string; status: ShellStatus };

/**
 * Chooses only the supported system executable; non-Windows branches declare future work without executing it.
 */
export function selectShellPlatform(platform: string = process.platform): string {
  if (platform === 'win32') {
    const windows = process.env.SystemRoot;
    if (!windows || !win32.isAbsolute(windows)) {
      throw new Error('System Windows directory is unavailable.');
    }
    return win32.join(windows, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  } else if (platform === 'linux') {
    // TODO: detect system Bash and implement Linux process-tree cleanup before exposing bash.
    throw new Error('Executor Linux shell backend is not implemented.');
  } else if (platform === 'darwin') {
    // TODO: detect system Bash and implement macOS process-tree cleanup before exposing bash.
    throw new Error('Executor macOS shell backend is not implemented.');
  } else {
    throw new Error('Unsupported Executor shell platform.');
  }
}

/**
 * Returns only Windows-owned system module paths, independent from inherited PSModulePath or user profiles.
 */
export function systemModulePath(executable: string): string {
  return [
    join(dirname(executable), 'Modules'),
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'WindowsPowerShell', 'Modules'),
  ].join(';');
}

/**
 * Probes the selected executable once with a fixed command, bounded output and deadline; never falls back or downloads.
 */
export async function inspectSystemShell(): Promise<SystemShell> {
  const executable = selectShellPlatform();
  /**
   * Projects a finite failure code without exposing probe output or changing the selected interpreter.
   */
  const unavailable = (code: ShellStatus['code']): SystemShell => ({
    executable,
    status: { kind: 'powershell', version: null, available: false, code },
  });
  try {
    const file = await lstat(executable);
    if (!file.isFile() || file.isSymbolicLink()) {
      return unavailable('SHELL_NOT_FOUND');
    }
  } catch {
    return unavailable('SHELL_NOT_FOUND');
  }
  try {
    const { stdout } = await run(
      executable,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '[Console]::Write($PSVersionTable.PSVersion.ToString())',
      ],
      {
        windowsHide: true,
        timeout: 10000,
        maxBuffer: 4096,
        env: {
          SystemRoot: process.env.SystemRoot,
          WINDIR: process.env.SystemRoot,
          PSModulePath: systemModulePath(executable),
        },
      }
    );
    const version = stdout.trim();
    if (!/^5\.1\.\d+(?:\.\d+)?$/.test(version)) {
      return unavailable('SHELL_VERSION_UNSUPPORTED');
    }
    return { executable, status: { kind: 'powershell', version, available: true } };
  } catch {
    return unavailable('SHELL_PROBE_FAILED');
  }
}
