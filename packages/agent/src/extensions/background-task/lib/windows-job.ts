/**
 * @author Codex
 * @description Owns a non-inheritable Windows Job and assigns the inert runner before user code starts.
 */
import koffi from 'koffi';

const kernel = koffi.load('kernel32.dll');
const create = kernel.func('void * __stdcall CreateJobObjectW(void *, const char16_t *)');
const close = kernel.func('int __stdcall CloseHandle(void *)');
const open = kernel.func('void * __stdcall OpenProcess(uint32_t, int, uint32_t)');
const assign = kernel.func('int __stdcall AssignProcessToJobObject(void *, void *)');
const terminate = kernel.func('int __stdcall TerminateJobObject(void *, uint32_t)');
const set = kernel.func('int __stdcall SetInformationJobObject(void *, int, void *, uint32_t)');
const query = kernel.func('int __stdcall QueryInformationJobObject(void *, int, void *, uint32_t, void *)');
const lastError = kernel.func('uint32_t __stdcall GetLastError()');

/**
 * Establishes a kill-on-close Job for a runner that has not yet received its command.
 */
export function ownWindowsRunner(pid: number) {
  if (process.arch !== 'x64' && process.arch !== 'arm64') {
    throw new Error('UNSUPPORTED_WINDOWS_ARCH');
  }
  const job: unknown = create(null, null);
  if (!job) {
    throw new Error(`JOB_CREATE_FAILED: ${String(lastError())}`);
  }
  try {
    // JOBOBJECT_EXTENDED_LIMIT_INFORMATION, 64-bit ABI: BasicLimitInformation.LimitFlags offset 16.
    const limits = Buffer.alloc(144);
    limits.writeUInt32LE(0x2000, 16); // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, no breakaway.
    if (!set(job, 9, limits, limits.length)) {
      throw new Error(`JOB_LIMIT_FAILED: ${String(lastError())}`);
    }
    const child: unknown = open(0x0100 | 0x0001, 0, pid); // SET_QUOTA | TERMINATE
    if (!child) {
      throw new Error(`JOB_OPEN_FAILED: ${String(lastError())}`);
    }
    try {
      if (!assign(job, child)) {
        throw new Error(`JOB_ASSIGN_FAILED: ${String(lastError())}`);
      }
    } finally {
      close(child);
    }
  } catch (error) {
    close(job);
    throw error;
  }
  let closed = false;
  return {
    /**
     * Queries all descendants, including those surviving the original shell.
     */
    active(): boolean {
      const info = Buffer.alloc(48); // JOBOBJECT_BASIC_ACCOUNTING_INFORMATION
      if (!query(job, 1, info, info.length, null)) {
        throw new Error('JOB_QUERY_FAILED');
      }
      return info.readUInt32LE(40) !== 0;
    },
    /**
     * Windows has no universal graceful signal for arbitrary console/background programs.
     */
    stop(): void {
      if (!closed && !terminate(job, 1)) {
        throw new Error('JOB_TERMINATE_FAILED');
      }
    },
    /**
     * Releases the ownership handle once; kill-on-close covers parent process failure.
     */
    close(): void {
      if (!closed) {
        close(job);
      }
      closed = true;
    },
  };
}
