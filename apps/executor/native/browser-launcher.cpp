/**
 * @author Codex
 * @description Launches only the adjacent private Node/Host bundle in an owned kill-on-close Job with inherited protocol handles.
 */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <string>
#include "browser-identity.h"

/**
 * Checks the exact origins generated for this native build without consulting mutable process configuration.
 */
bool IsAllowedBrowserOrigin(const wchar_t* value) {
  const std::wstring origin(value);
  for (const auto allowed : kBrowserAllowedOrigins) {
    if (origin == allowed) { return true; }
  }
  return false;
}

/**
 * Accepts only the product extension origin and browser parent-window metadata, never a path or command.
 */
int wmain(int argc, wchar_t** argv) {
  if (argc < 2 || argc > 3 || !IsAllowedBrowserOrigin(argv[1]) ||
      (argc == 3 && std::wstring(argv[2]).find(L"--parent-window=") != 0)) { return 2; }
  wchar_t module[32768];
  const DWORD length = GetModuleFileNameW(nullptr, module, 32768);
  if (!length || length >= 32768) { return 3; }
  const std::wstring directory = std::wstring(module).substr(0, std::wstring(module).find_last_of(L'\\'));
  const std::wstring node = directory + L"\\..\\resources\\node\\node.exe";
  const std::wstring script = directory + L"\\..\\bridge\\native-host.cjs";
  std::wstring command = L"\"" + node + L"\" \"" + script + L"\" \"" + argv[1] + L"\"";
  SetEnvironmentVariableW(L"NODE_OPTIONS", nullptr);
  SetEnvironmentVariableW(L"NODE_PATH", nullptr);
  SetEnvironmentVariableW(L"NODE_REPL_EXTERNAL_MODULE", nullptr);
  SetEnvironmentVariableW(L"NODE_V8_COVERAGE", nullptr);
  SetEnvironmentVariableW(L"NODE_USE_ENV_PROXY", nullptr);
  SetEnvironmentVariableW(L"NODE_EXTRA_CA_CERTS", nullptr);
  SetEnvironmentVariableW(L"NODE_ICU_DATA", nullptr);
  SetEnvironmentVariableW(L"OPENSSL_CONF", nullptr);
  HANDLE job = CreateJobObjectW(nullptr, nullptr);
  if (!job) { return 4; }
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) { CloseHandle(job); return 4; }
  STARTUPINFOW startup{}; startup.cb = sizeof(startup); startup.dwFlags = STARTF_USESTDHANDLES;
  startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE); startup.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE); startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);
  PROCESS_INFORMATION process{};
  if (!CreateProcessW(node.c_str(), command.data(), nullptr, nullptr, TRUE, CREATE_SUSPENDED | CREATE_NO_WINDOW, nullptr, directory.c_str(), &startup, &process)) { CloseHandle(job); return 5; }
  if (!AssignProcessToJobObject(job, process.hProcess)) {
    TerminateProcess(process.hProcess, 6); CloseHandle(process.hThread); CloseHandle(process.hProcess); CloseHandle(job); return 6;
  }
  ResumeThread(process.hThread); CloseHandle(process.hThread);
  WaitForSingleObject(process.hProcess, INFINITE);
  DWORD code = 1; GetExitCodeProcess(process.hProcess, &code);
  CloseHandle(process.hProcess); CloseHandle(job);
  return static_cast<int>(code);
}
