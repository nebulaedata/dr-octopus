/**
 * @author Codex
 * @description Starts fixed system PowerShell or private search argv suspended in a kill-on-close Job and confirms bounded output/tree cleanup.
 */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <fcntl.h>
#include <io.h>
#include <atomic>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

static std::mutex outputMutex;
static std::atomic<int> control{0};
static std::atomic<unsigned long long> outputBytes{0};
static unsigned long long outputLimit = 64ULL * 1024 * 1024;

/**
 * Writes one trusted frame; child bytes are always payload and cannot impersonate completion.
 */
static bool frame(unsigned char kind, const char* bytes, DWORD size) {
  std::lock_guard<std::mutex> lock(outputMutex);
  HANDLE output = GetStdHandle(STD_OUTPUT_HANDLE);
  unsigned char header[5] = {kind, static_cast<unsigned char>(size),
    static_cast<unsigned char>(size >> 8), static_cast<unsigned char>(size >> 16),
    static_cast<unsigned char>(size >> 24)};
  DWORD done;
  if (!WriteFile(output, header, 5, &done, nullptr) || done != 5) return false;
  while (size) {
    if (!WriteFile(output, bytes, size, &done, nullptr) || !done) return false;
    bytes += done; size -= done;
  }
  return true;
}

/**
 * Drains one child stream until EOF, including after a preview has been truncated by the parent.
 */
static void drain(HANDLE pipe, unsigned char kind) {
  char bytes[16384]; DWORD count;
  while (ReadFile(pipe, bytes, sizeof(bytes), &count, nullptr) && count) {
    auto previous = outputBytes.fetch_add(count);
    const unsigned long long limit = outputLimit;
    DWORD keep = previous >= limit ? 0 : static_cast<DWORD>((limit - previous < count) ? limit - previous : count);
    if (keep < count) control.store(2);
    if (keep && !frame(kind, bytes, keep)) { control.store(1); break; }
  }
  CloseHandle(pipe);
}

/**
 * Quotes one CreateProcess argv token using Windows backslash and quote rules.
 */
static std::wstring quote(const std::wstring& value) {
  std::wstring result = L"\""; size_t slashes = 0;
  for (wchar_t ch : value) {
    if (ch == L'\\') { ++slashes; continue; }
    result.append(slashes * (ch == L'"' ? 2 : 1), L'\\'); slashes = 0;
    if (ch == L'"') result += L'\\';
    result += ch;
  }
  result.append(slashes * 2, L'\\'); return result + L'"';
}

/**
 * Queries the complete owned Job rather than treating the root PID's exit as quiescence.
 */
static DWORD active(HANDLE job) {
  JOBOBJECT_BASIC_ACCOUNTING_INFORMATION info{};
  if (!QueryInformationJobObject(job, JobObjectBasicAccountingInformation, &info, sizeof(info), nullptr))
    return MAXDWORD;
  return info.ActiveProcesses;
}

/**
 * Reads only an already available parent byte; avoids cancelling a control thread before it enters blocking I/O.
 * The supervisor is the sole reader. Returns true after the first byte or disconnect, preserving single-byte admission.
 */
static bool observeControl() {
  DWORD available = 0;
  HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
  if (!PeekNamedPipe(input, nullptr, 0, nullptr, &available, nullptr)) { control.store(1); return true; }
  if (!available) return false;
  char byte; DWORD count = 0;
  if (ReadFile(input, &byte, 1, &count, nullptr) && count) control.store(byte == 'L' ? 2 : 1);
  else control.store(1);
  return true;
}

/**
 * Runs system PowerShell or finite search argv; stdin control is parent-only and stdout is framed.
 * argv: executable, cwd, --powershell/--search, timeout milliseconds, parent PID, script/search arguments.
 */
int wmain(int argc, wchar_t** argv) {
  const bool direct = argc >= 8 && std::wstring(argv[3]) == L"--search";
  const bool powershell = argc == 7 && std::wstring(argv[3]) == L"--powershell";
  if (!direct && !powershell) return 2;
  if (powershell) {
    wchar_t system[MAX_PATH];
    UINT length = GetSystemDirectoryW(system, MAX_PATH);
    if (!length || length >= MAX_PATH) return 2;
    std::wstring expected = std::wstring(system) + L"\\WindowsPowerShell\\v1.0\\powershell.exe";
    if (_wcsicmp(argv[1], expected.c_str()) != 0) return 2;
  }
  if (direct) outputLimit = 2ULL * 1024 * 1024;
  DWORD timeout = wcstoul(argv[4], nullptr, 10);
  DWORD parentPid = wcstoul(argv[5], nullptr, 10);
  if (!timeout || timeout > 600000 || !parentPid) return 2;
  HANDLE parent = OpenProcess(SYNCHRONIZE, FALSE, parentPid);
  HANDLE job = CreateJobObjectW(nullptr, nullptr);
  if (!parent || !job) return 2;
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) return 2;
  SECURITY_ATTRIBUTES security{sizeof(security), nullptr, TRUE};
  HANDLE outRead, outWrite, errRead, errWrite;
  if (!CreatePipe(&outRead, &outWrite, &security, 0) ||
      !CreatePipe(&errRead, &errWrite, &security, 0)) return 2;
  SetHandleInformation(outRead, HANDLE_FLAG_INHERIT, 0);
  SetHandleInformation(errRead, HANDLE_FLAG_INHERIT, 0);
  HANDLE input = CreateFileW(L"NUL", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
    &security, OPEN_EXISTING, 0, nullptr);
  if (input == INVALID_HANDLE_VALUE) return 2;
  SIZE_T size = 0;
  InitializeProcThreadAttributeList(nullptr, 1, 0, &size);
  std::vector<unsigned char> attributes(size);
  auto list = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attributes.data());
  if (!InitializeProcThreadAttributeList(list, 1, 0, &size)) return 2;
  HANDLE inherited[] = {input, outWrite, errWrite};
  if (!UpdateProcThreadAttribute(list, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
    inherited, sizeof(inherited), nullptr, nullptr)) return 2;
  STARTUPINFOEXW startup{}; startup.StartupInfo.cb = sizeof(startup);
  startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
  startup.StartupInfo.hStdInput = input; startup.StartupInfo.hStdOutput = outWrite;
  startup.StartupInfo.hStdError = errWrite; startup.lpAttributeList = list;
  std::wstring command = quote(argv[1]) + L" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " + quote(argv[6]);
  if (direct) {
    command = quote(argv[1]);
    for (int i = 6; i < argc; ++i) command += L" " + quote(argv[i]);
  }
  if (command.size() >= 32767) return 2;
  PROCESS_INFORMATION process{};
  bool created = CreateProcessW(argv[1], command.data(), nullptr, nullptr, TRUE,
    CREATE_SUSPENDED | CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT,
    nullptr, argv[2], &startup.StartupInfo, &process) != FALSE;
  DeleteProcThreadAttributeList(list);
  CloseHandle(input); CloseHandle(outWrite); CloseHandle(errWrite);
  if (!created) { CloseHandle(outRead); CloseHandle(errRead); return 2; }
  if (!AssignProcessToJobObject(job, process.hProcess)) {
    TerminateProcess(process.hProcess, 1); WaitForSingleObject(process.hProcess, INFINITE); return 2;
  }
  std::thread stdoutThread(drain, outRead, 1), stderrThread(drain, errRead, 2);
  bool started = ResumeThread(process.hThread) != static_cast<DWORD>(-1);
  CloseHandle(process.hThread);
  ULONGLONG beginning = GetTickCount64();
  std::string reason = started ? "completed" : "launch_failed";
  bool observedControl = false;
  if (!started) TerminateJobObject(job, 1);
  while (started) {
    if (!observedControl) observedControl = observeControl();
    if (WaitForSingleObject(parent, 0) == WAIT_OBJECT_0 || control.load() == 1) {
      reason = "cancelled"; break;
    }
    if (control.load() == 2) { reason = "output_limit"; break; }
    if (GetTickCount64() - beginning >= timeout) { reason = "timeout"; break; }
    if (WaitForSingleObject(process.hProcess, 10) == WAIT_OBJECT_0) {
      // Process handles become signaled before Job accounting necessarily retires the last process.
      ULONGLONG settle = GetTickCount64();
      while (active(job) != 0 && GetTickCount64() - settle < 200) Sleep(5);
      if (active(job) != 0) reason = "background_process_rejected";
      break;
    }
  }
  DWORD exitCode = 1;
  GetExitCodeProcess(process.hProcess, &exitCode);
  if (reason != "completed") TerminateJobObject(job, 1);
  ULONGLONG cleanup = GetTickCount64();
  while (active(job) != 0 && GetTickCount64() - cleanup < 5000) Sleep(10);
  bool quiet = active(job) == 0;
  if (!quiet) {
    // Closing the last Job handle still requests termination; never send false completion.
    CloseHandle(job); ExitProcess(3);
  }
  GetExitCodeProcess(process.hProcess, &exitCode);
  stdoutThread.join(); stderrThread.join();
  if (control.load() == 2 && reason == "completed") reason = "output_limit";
  std::string result = "{\"started\":" + std::string(started ? "true" : "false") +
    ",\"quiescent\":true,\"exitCode\":" + std::to_string(exitCode) +
    ",\"reason\":\"" + reason + "\"}";
  frame(3, result.data(), static_cast<DWORD>(result.size()));
  CloseHandle(process.hProcess); CloseHandle(job); CloseHandle(parent);
  return 0;
}
