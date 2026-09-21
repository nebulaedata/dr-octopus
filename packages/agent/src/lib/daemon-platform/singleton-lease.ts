/**
 * @author Codex
 * @description Process-lifetime OS file locks; never infer ownership from timestamps or PIDs.
 */
import { closeSync, openSync } from 'node:fs';
import { ProcessLifecycleError } from './error.js';
import type { ProcessLock } from './error.js';

/**
 * Acquire a non-blocking exclusive lock; null means another process owns it.
 * The caller must keep the lock file in place permanently and close resources before release.
 */
export async function tryAcquireProcessLock(
  path: string,
  mode: 'exclusive' | 'shared' = 'exclusive'
): Promise<ProcessLock | null> {
  if (process.platform === 'win32') {
    const { windowsNative: win } = await import('./windows-native.js');
    // No SECURITY_ATTRIBUTES: handles cannot be inherited by Runner children.
    const handle = win.createFile(path, 0xc0000000, 3, null, 4, 0x80, null);
    const locked = win.lock(handle, mode === 'shared' ? 1 : 3, 0, 1, 0, {
      internal: 0,
      internalHigh: 0,
      offset: 0,
      offsetHigh: 0,
      event: null,
    });
    if (!locked) {
      const code = win.lastError();
      win.close(handle);
      if (code === 33) {
        return null;
      }
      throw new ProcessLifecycleError('PROCESS_LOCK_FAILED', `Windows lock failed (${code})`);
    }
    return once(() => {
      win.close(handle);
    });
  }
  if (process.platform !== 'linux' && process.platform !== 'darwin') {
    throw new ProcessLifecycleError('PROCESS_LOCK_UNSUPPORTED', 'Unsupported daemon lock platform');
  }
  const { default: koffi } = await import('koffi');
  const libc = koffi.load(process.platform === 'darwin' ? 'libSystem.B.dylib' : 'libc.so.6');
  const flock = libc.func('int flock(int, int)') as (fd: number, operation: number) => number;
  const fd = openSync(path, 'a+', 0o600);
  if (flock(fd, (mode === 'shared' ? 1 : 2) | 4) !== 0) {
    const code = koffi.errno();
    closeSync(fd);
    if (code === 11 || code === 35) {
      return null;
    }
    throw new ProcessLifecycleError('PROCESS_LOCK_FAILED', `Unix lock failed (${code})`);
  }
  return once(() => {
    closeSync(fd);
  });
}

/**
 * Make lock release idempotent without introducing an expiring ownership lease.
 */
function once(close: () => void): ProcessLock {
  let released = false;
  return {
    /**
     * Close only this owner's handle; never unlink the shared lock carrier.
     */
    release() {
      if (!released) {
        released = true;
        close();
      }
    },
  };
}
