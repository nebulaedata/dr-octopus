/**
 * @author Codex
 * @description Launch a daemon process independently of Runtime pipes, handles and Windows jobs.
 */
import { spawn } from 'node:child_process';
import { ProcessLifecycleError } from './error.js';

/**
 * Encode one argument using Windows CRT parsing rules, without invoking a shell.
 */
export function quoteWindowsArgument(value: string): string {
  if (value.includes('\0')) {
    throw new Error('NUL in process argument');
  }
  return '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1') + '"';
}

/**
 * Start an independent Node entry. Caller cancellation cannot terminate a launched shared service.
 * Windows starts suspended, verifies job detachment, then resumes; unsupported jobs fail closed.
 */
export async function launchDetachedNode(args: string[], cwd: string): Promise<number> {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.NODE_CHANNEL_FD;
  delete env.NODE_CHANNEL_SERIALIZATION_MODE;
  for (const key of Object.keys(env)) {
    if (key.startsWith('OCTOPUS_RUNTIME_')) {
      delete env[key];
    }
  }
  if (process.platform !== 'win32') {
    const child = spawn(process.execPath, args, { cwd, env, detached: true, stdio: 'ignore' });
    return new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve(child.pid!);
      });
    });
  }
  const { windowsNative: win } = await import('./windows-native.js');
  const command = Buffer.from(
    [process.execPath, ...args].map(quoteWindowsArgument).join(' ') + '\0',
    'utf16le'
  );
  const environment = Buffer.from(
    Object.entries(env)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .sort(([a], [b]) => a.toUpperCase().localeCompare(b.toUpperCase()))
      .map(([key, value]) => `${key}=${value}`)
      .join('\0') + '\0\0',
    'utf16le'
  );
  const info: { process?: unknown; thread?: unknown; processId?: number } = {};
  // BREAKAWAY_FROM_JOB | CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW.
  const created = win.createProcess(
    process.execPath,
    command,
    null,
    null,
    0,
    0x01000000 | 4 | 0x400 | 0x08000000,
    environment,
    cwd,
    { cb: win.startupSize, flags: 1, show: 0 },
    info
  );
  if (!created) {
    const { launchWindowsBroker } = await import('./windows-broker.js');
    return launchWindowsBroker(args, cwd, env, quoteWindowsArgument);
  }
  try {
    const inJob = [0];
    if (!win.isInJob(info.process, null, inJob) || inJob[0] !== 0) {
      throw new ProcessLifecycleError(
        'PROCESS_DETACH_UNSUPPORTED',
        'Daemon remains attached to a Windows Job'
      );
    }
    if (win.resume(info.thread) === 0xffffffff) {
      throw new ProcessLifecycleError('PROCESS_START_FAILED', 'Cannot resume daemon process');
    }
    return info.processId!;
  } catch (error) {
    win.terminate(info.process, 1);
    if (error instanceof ProcessLifecycleError && error.code === 'PROCESS_DETACH_UNSUPPORTED') {
      const { launchWindowsBroker } = await import('./windows-broker.js');
      return launchWindowsBroker(args, cwd, env, quoteWindowsArgument);
    }
    throw error;
  } finally {
    win.close(info.thread);
    win.close(info.process);
  }
}
