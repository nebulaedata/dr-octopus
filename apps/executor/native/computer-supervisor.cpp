/**
 * @author Codex
 * @description Owns a fixed stdio backend in a kill-on-close Windows Job and confirms complete tree cleanup through its own exit code.
 */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <atomic>
#include <string>
#include <thread>
#include <vector>

static std::atomic<bool> stopping{false};

/**
 * Quotes a trusted Windows argv token without invoking a shell.
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
 * Copies bytes under native pipe backpressure; EOF or a broken pipe requests bounded tree cleanup.
 */
static void pump(HANDLE source, HANDLE target, bool stopOnEnd) {
  char bytes[16384]; DWORD count;
  while (ReadFile(source, bytes, sizeof(bytes), &count, nullptr) && count) {
    DWORD offset = 0;
    while (offset < count) {
      DWORD done = 0;
      if (!WriteFile(target, bytes + offset, count - offset, &done, nullptr) || !done) {
        stopping.store(true); return;
      }
      offset += done;
    }
  }
  if (stopOnEnd) stopping.store(true);
}

/**
 * Reads Job membership; failure cannot masquerade as an empty process tree.
 */
static DWORD active(HANDLE job) {
  JOBOBJECT_BASIC_ACCOUNTING_INFORMATION info{};
  return QueryInformationJobObject(job, JobObjectBasicAccountingInformation, &info, sizeof(info), nullptr)
    ? info.ActiveProcesses : MAXDWORD;
}

/**
 * Launches trusted Host argv suspended, assigns the Job before execution and never inherits the Job into the backend.
 * argv: executable, resource cwd, parent PID, fixed backend arguments. Exit zero means owned tree is confirmed empty.
 */
int wmain(int argc, wchar_t** argv) {
  if (argc < 5) return 2;
  wchar_t* end = nullptr;
  DWORD pid = wcstoul(argv[3], &end, 10);
  if (!pid || !end || *end) return 2;
  HANDLE parent = OpenProcess(SYNCHRONIZE, FALSE, pid);
  HANDLE job = CreateJobObjectW(nullptr, nullptr);
  if (!parent || !job) return 2;
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) return 2;
  SECURITY_ATTRIBUTES sa{sizeof(sa), nullptr, TRUE};
  HANDLE inRead, inWrite, outRead, outWrite, errRead, errWrite;
  if (!CreatePipe(&inRead, &inWrite, &sa, 0) || !CreatePipe(&outRead, &outWrite, &sa, 0) || !CreatePipe(&errRead, &errWrite, &sa, 0)) return 2;
  SetHandleInformation(inWrite, HANDLE_FLAG_INHERIT, 0);
  SetHandleInformation(outRead, HANDLE_FLAG_INHERIT, 0);
  SetHandleInformation(errRead, HANDLE_FLAG_INHERIT, 0);
  SIZE_T size = 0;
  InitializeProcThreadAttributeList(nullptr, 1, 0, &size);
  std::vector<unsigned char> attributes(size);
  auto list = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attributes.data());
  if (!InitializeProcThreadAttributeList(list, 1, 0, &size)) return 2;
  HANDLE inherited[] = {inRead, outWrite, errWrite};
  if (!UpdateProcThreadAttribute(list, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, inherited, sizeof(inherited), nullptr, nullptr)) return 2;
  STARTUPINFOEXW startup{};
  startup.StartupInfo.cb = sizeof(startup);
  startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
  startup.StartupInfo.hStdInput = inRead;
  startup.StartupInfo.hStdOutput = outWrite;
  startup.StartupInfo.hStdError = errWrite;
  startup.lpAttributeList = list;
  std::wstring command = quote(argv[1]);
  for (int i = 4; i < argc; i++) command += L" " + quote(argv[i]);
  if (command.size() >= 32767) return 2;
  PROCESS_INFORMATION child{};
  bool created = CreateProcessW(argv[1], command.data(), nullptr, nullptr, TRUE,
    CREATE_SUSPENDED | CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT, nullptr, argv[2], &startup.StartupInfo, &child) != FALSE;
  DeleteProcThreadAttributeList(list);
  CloseHandle(inRead); CloseHandle(outWrite); CloseHandle(errWrite);
  if (!created) return 2;
  if (!AssignProcessToJobObject(job, child.hProcess)) {
    TerminateProcess(child.hProcess, 1); WaitForSingleObject(child.hProcess, 5000); return 2;
  }
  std::thread input(pump, GetStdHandle(STD_INPUT_HANDLE), inWrite, true);
  std::thread output(pump, outRead, GetStdHandle(STD_OUTPUT_HANDLE), true);
  std::thread error(pump, errRead, GetStdHandle(STD_ERROR_HANDLE), false);
  bool started = ResumeThread(child.hThread) != static_cast<DWORD>(-1);
  CloseHandle(child.hThread);
  while (started && !stopping.load() && WaitForSingleObject(parent, 0) != WAIT_OBJECT_0 && WaitForSingleObject(child.hProcess, 10) != WAIT_OBJECT_0) {}
  // Stdin EOF, parent exit and backend failure all stop this exact owned Job, including descendants.
  TerminateJobObject(job, 1);
  ULONGLONG beginning = GetTickCount64();
  while (active(job) != 0 && GetTickCount64() - beginning < 1500) Sleep(5);
  if (active(job) != 0) { CloseHandle(job); ExitProcess(3); }
  CancelSynchronousIo(input.native_handle());
  CancelSynchronousIo(output.native_handle());
  CancelSynchronousIo(error.native_handle());
  input.join(); output.join(); error.join();
  CloseHandle(inWrite); CloseHandle(outRead); CloseHandle(errRead);
  CloseHandle(child.hProcess); CloseHandle(job); CloseHandle(parent);
  return started ? 0 : 2;
}
