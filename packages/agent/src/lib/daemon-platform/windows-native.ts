/**
 * @author Codex
 * @description Narrow Windows kernel bindings for non-inherited locks and verified daemon detachment.
 */
import koffi from 'koffi';

const kernel = koffi.load('kernel32.dll');
const overlap = koffi.struct('DaemonOverlapped', {
  internal: 'uintptr_t',
  internalHigh: 'uintptr_t',
  offset: 'uint32_t',
  offsetHigh: 'uint32_t',
  event: 'void *',
});
const startup = koffi.struct('DaemonStartupInfo', {
  cb: 'uint32_t',
  reserved: 'void *',
  desktop: 'void *',
  title: 'void *',
  x: 'uint32_t',
  y: 'uint32_t',
  xSize: 'uint32_t',
  ySize: 'uint32_t',
  xCount: 'uint32_t',
  yCount: 'uint32_t',
  fill: 'uint32_t',
  flags: 'uint32_t',
  show: 'uint16_t',
  reservedSize: 'uint16_t',
  reservedBytes: 'void *',
  stdin: 'void *',
  stdout: 'void *',
  stderr: 'void *',
});
const processInfo = koffi.struct('DaemonProcessInfo', {
  process: 'void *',
  thread: 'void *',
  processId: 'uint32_t',
  threadId: 'uint32_t',
});

const jobLimits = koffi.struct('DaemonJobLimits', {
  processTime: 'int64_t',
  jobTime: 'int64_t',
  limitFlags: 'uint32_t',
  minimumWorkingSet: 'size_t',
  maximumWorkingSet: 'size_t',
  activeProcesses: 'uint32_t',
  affinity: 'uintptr_t',
  priorityClass: 'uint32_t',
  schedulingClass: 'uint32_t',
});
const extendedJobLimits = koffi.struct('DaemonExtendedJobLimits', {
  basic: jobLimits,
  ioCounters: koffi.array('uint64_t', 6),
  processMemory: 'size_t',
  jobMemory: 'size_t',
  peakProcessMemory: 'size_t',
  peakJobMemory: 'size_t',
});
const queryJob = kernel.func('QueryInformationJobObject', 'int', [
  'void *',
  'int',
  koffi.out(koffi.pointer(extendedJobLimits)),
  'uint32_t',
  'void *',
]) as (job: null, informationClass: number, result: object, size: number, length: null) => number;

// Native declarations are contained here; consumers receive domain contracts.
export const windowsNative = {
  createFile: kernel.func(
    'void * __stdcall CreateFileW(const char16_t *, uint32_t, uint32_t, void *, uint32_t, uint32_t, void *)'
  ) as (
    path: string,
    access: number,
    share: number,
    security: null,
    creation: number,
    flags: number,
    template: null
  ) => unknown,
  close: kernel.func('int __stdcall CloseHandle(void *)') as (handle: unknown) => number,
  lastError: kernel.func('uint32_t __stdcall GetLastError()') as () => number,
  lock: kernel.func('LockFileEx', 'int', [
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
  ) => number,
  currentProcess: kernel.func('void * __stdcall GetCurrentProcess()') as () => unknown,
  isInJob: kernel.func('int __stdcall IsProcessInJob(void *, void *, _Out_ int *)') as (
    handle: unknown,
    job: null,
    result: number[]
  ) => number,
  /**
   * Query the calling process's immediate Job; failure must never imply unrestricted execution.
   */
  currentJobLimitFlags(): number | undefined {
    const result: { basic?: { limitFlags: number } } = {};
    return queryJob(null, 9, result, koffi.sizeof(extendedJobLimits), null)
      ? result.basic?.limitFlags
      : undefined;
  },
  createProcess: kernel.func('CreateProcessW', 'int', [
    'str16',
    'void *',
    'void *',
    'void *',
    'int',
    'uint32_t',
    'void *',
    'str16',
    koffi.pointer(startup),
    koffi.out(koffi.pointer(processInfo)),
  ]) as (
    exe: string,
    command: Buffer,
    processSecurity: null,
    threadSecurity: null,
    inherit: number,
    flags: number,
    env: Buffer,
    cwd: string,
    startup: object,
    result: WindowsProcessInfo
  ) => number,
  resume: kernel.func('uint32_t __stdcall ResumeThread(void *)') as (thread: unknown) => number,
  terminate: kernel.func('int __stdcall TerminateProcess(void *, uint32_t)') as (
    handle: unknown,
    code: number
  ) => number,
  startupSize: koffi.sizeof(startup),
};

export interface WindowsProcessInfo {
  process?: unknown;
  thread?: unknown;
  processId?: number;
  threadId?: number;
}
