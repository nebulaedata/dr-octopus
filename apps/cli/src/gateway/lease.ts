/**
 * @author Codex
 * @description Acquires a non-inherited OS file lock that is automatically released on Gateway process death.
 */
import { closeSync, openSync } from 'node:fs';
import { createRequire } from 'node:module';
import { gatewayError } from './protocol.js';
import type Koffi from 'koffi';

/**
 * Holds one permanent lock carrier; never unlink it or infer lock ownership from a PID or heartbeat.
 */
export function acquireLease(
  path: string,
  koffi: typeof Koffi = createRequire(import.meta.url)('koffi') as typeof Koffi
): () => void {
  let close: () => void;
  if (process.platform === 'win32') {
    const kernel = koffi.load('kernel32.dll');
    const overlap = koffi.struct({
      internal: 'uintptr_t',
      internalHigh: 'uintptr_t',
      offset: 'uint32_t',
      offsetHigh: 'uint32_t',
      event: 'void *',
    });
    const createFile = kernel.func(
      'void * __stdcall CreateFileW(const char16_t *, uint32_t, uint32_t, void *, uint32_t, uint32_t, void *)'
    ) as (
      path: string,
      access: number,
      share: number,
      security: null,
      creation: number,
      flags: number,
      template: null
    ) => unknown;
    const closeHandle = kernel.func('int __stdcall CloseHandle(void *)') as (handle: unknown) => number;
    const lastError = kernel.func('uint32_t __stdcall GetLastError()') as () => number;
    const lock = kernel.func('LockFileEx', 'int', [
      'void *',
      'uint32_t',
      'uint32_t',
      'uint32_t',
      'uint32_t',
      koffi.pointer(overlap),
    ]) as (
      handle: unknown,
      flags: number,
      reserved: number,
      low: number,
      high: number,
      overlap: object
    ) => number;
    const handle = createFile(path, 0xc0000000, 3, null, 4, 0x80, null);
    if (!lock(handle, 3, 0, 1, 0, { internal: 0, internalHigh: 0, offset: 0, offsetHigh: 0, event: null })) {
      const code = lastError();
      closeHandle(handle);
      throw gatewayError(
        code === 33 ? 'GATEWAY_ALREADY_RUNNING' : 'GATEWAY_LOCK_FAILED',
        `Gateway lock unavailable (${String(code)}).`
      );
    }
    close = () => {
      closeHandle(handle);
    };
  } else if (process.platform === 'linux' || process.platform === 'darwin') {
    const libc = koffi.load(process.platform === 'darwin' ? 'libSystem.B.dylib' : 'libc.so.6');
    const flock = libc.func('int flock(int, int)') as (fd: number, operation: number) => number;
    const fd = openSync(path, 'a+', 0o600);
    if (flock(fd, 6) !== 0) {
      const code = koffi.errno();
      closeSync(fd);
      throw gatewayError(
        code === 11 || code === 35 ? 'GATEWAY_ALREADY_RUNNING' : 'GATEWAY_LOCK_FAILED',
        `Gateway lock unavailable (${String(code)}).`
      );
    }
    close = () => closeSync(fd);
  } else {
    throw gatewayError('GATEWAY_LOCK_UNSUPPORTED', `Unsupported platform: ${process.platform}`);
  }
  let closed = false;
  return () => {
    if (!closed) {
      closed = true;
      close();
    }
  };
}
