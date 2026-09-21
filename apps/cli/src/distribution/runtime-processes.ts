/**
 * @author Codex
 * @description Finds runtime users across Agent profiles without importing or starting old Agent SDKs.
 */
import { execFile } from 'node:child_process';
import { readdir, readFile, readlink, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { isProcessAlive } from '../gateway/index.js';

const run = promisify(execFile);

/**
 * Normalizes command lines and paths for platform-appropriate containment matching.
 */
function normalize(value: string): string {
  const path = value.replaceAll('\\', '/').replace(/\/{2,}/g, '/');
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

/**
 * Matches an absolute runtime path, avoiding collisions with longer directory names.
 */
export function referencesRuntime(command: string, root: string): boolean {
  const text = normalize(command);
  const path = normalize(root);
  return (
    text.includes(path + '/') ||
    text.includes(path + '\0') ||
    text.includes(path + '"') ||
    text.includes(path + "'") ||
    text.endsWith(path)
  );
}

/**
 * Returns process command lines and Linux working directories; inspection failures abort pruning.
 * Includes every profile and foreground TUI, rather than only the default Scheduler data directory.
 */
export async function runtimeProcesses(): Promise<string[]> {
  if (process.platform === 'win32') {
    const { stdout } = await run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "$ErrorActionPreference='Stop'; ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | Select-Object ProcessId,CommandLine)",
      ],
      { windowsHide: true, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }
    );
    const records = JSON.parse(stdout) as { ProcessId: number; CommandLine: string | null }[];
    return records
      .filter((record) => record.ProcessId !== process.pid && isProcessAlive(record.ProcessId))
      .map((record) => {
        if (!record.CommandLine) {
          throw new Error('Cannot inspect a Node process command line.');
        }
        return record.CommandLine;
      });
  }
  if (process.platform === 'linux') {
    const commands: string[] = [];
    for (const pid of await readdir('/proc')) {
      if (!/^\d+$/.test(pid) || Number(pid) === process.pid) {
        continue;
      }
      try {
        if ((await stat(`/proc/${pid}`)).uid !== process.getuid!()) {
          continue;
        }
        const command = await readFile(`/proc/${pid}/cmdline`, 'utf8');
        if (!command) {
          continue;
        }
        commands.push(command, await readlink(`/proc/${pid}/cwd`));
      } catch (error) {
        if (!['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) {
          throw error;
        }
      }
    }
    return commands;
  }
  if (process.platform === 'darwin') {
    const { stdout } = await run('ps', ['-ww', '-U', String(process.getuid!()), '-o', 'pid=,args='], {
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout.split('\n').filter((line) => Number(line.trim().split(/\s+/)[0]) !== process.pid);
  }
  throw new Error(`Runtime process inspection is unsupported on ${process.platform}.`);
}
