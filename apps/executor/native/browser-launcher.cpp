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
 * Quotes one Windows argument, including trailing backslashes, without invoking a command shell.
 */
static std::wstring QuoteArgument(const std::wstring& value) {
  std::wstring result = L"\"";
  size_t slashes = 0;
  for (const wchar_t c : value) {
    if (c == L'\\') { slashes++; continue; }
    if (c == L'\"') { result.append(slashes * 2 + 1, L'\\'); }
    else { result.append(slashes, L'\\'); }
    result += c;
    slashes = 0;
  }
  result.append(slashes * 2, L'\\');
  return result + L'\"';
}

/**
 * Accepts exact browser origins or finite local maintenance operations; executable and script paths always derive from this module.
 */
int wmain(int argc, wchar_t** argv) {
  const bool maintenance = argc >= 2 && std::wstring(argv[1]) == L"--maintain";
  if (maintenance) {
    if (argc < 4 || argc > 5) { return 2; }
    const std::wstring mode(argv[2]);
    const std::wstring project(argv[3]);
    if ((mode != L"install" && mode != L"remove" && mode != L"inspect") || project.size() < 3 || project.size() > 30000 || project[1] != L':' || project[2] != L'\\') { return 2; }
    if (argc == 5) {
      const std::wstring request(argv[4]);
      if (request.size() > 300 || request.find_first_not_of(L"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=") != std::wstring::npos) { return 2; }
    }
  } else if (argc < 2 || argc > 3 || !IsAllowedBrowserOrigin(argv[1]) ||
      (argc == 3 && std::wstring(argv[2]).find(L"--parent-window=") != 0)) { return 2; }
  wchar_t module[32768];
  const DWORD length = GetModuleFileNameW(nullptr, module, 32768);
  if (!length || length >= 32768) { return 3; }
  const std::wstring directory = std::wstring(module).substr(0, std::wstring(module).find_last_of(L'\\'));
  const std::wstring node = directory + L"\\..\\resources\\node\\node.exe";
  const std::wstring root = directory + L"\\..";
  const std::wstring script = root + (maintenance ? L"\\setup\\browser-host.cjs" : L"\\bridge\\native-host.cjs");
  std::wstring command = QuoteArgument(node) + L" " + QuoteArgument(script);
  if (maintenance) {
    command += L" " + QuoteArgument(argv[2]) + L" " + QuoteArgument(root) + L" " + QuoteArgument(argv[3]);
    if (argc == 5) { command += L" " + QuoteArgument(argv[4]); }
  } else { command += L" " + QuoteArgument(argv[1]); }
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
  const DWORD waited = WaitForSingleObject(process.hProcess, maintenance ? 55000 : INFINITE);
  if (waited != WAIT_OBJECT_0) {
    TerminateJobObject(job, 10);
    WaitForSingleObject(process.hProcess, 5000);
  }
  DWORD code = 1; GetExitCodeProcess(process.hProcess, &code);
  CloseHandle(process.hProcess); CloseHandle(job);
  return static_cast<int>(code);
}
