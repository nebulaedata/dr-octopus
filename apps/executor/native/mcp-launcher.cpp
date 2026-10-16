/**
 * @author Codex
 * @description Starts only the adjacent private Node stdio adapter in a kill-on-close Job, never a second Runtime or a system Node.
 */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <string>
#include <cwctype>

/**
 * Accepts one absolute configuration path and fixed mode; credentials and commands are never arguments.
 */
int wmain(int argc, wchar_t** argv) {
  if (argc != 4 || std::wstring(argv[1]) != L"--mcp-stdio" || std::wstring(argv[2]) != L"--config") { return 2; }
  const std::wstring config = argv[3];
  if (config.size() < 4 || config.size() > 30000 || !iswalpha(config[0]) || config[1] != L':' || config[2] != L'\\' ||
      config.find_first_of(L"\"\r\n") != std::wstring::npos || config.back() == L'\\') { return 2; }
  wchar_t module[32768];
  const DWORD length = GetModuleFileNameW(nullptr, module, 32768);
  if (!length || length >= 32768) { return 3; }
  const std::wstring directory = std::wstring(module).substr(0, std::wstring(module).find_last_of(L'\\'));
  const std::wstring node = directory + L"\\..\\resources\\node\\node.exe";
  const std::wstring script = directory + L"\\..\\bridge\\mcp-stdio.cjs";
  std::wstring command = L"\"" + node + L"\" \"" + script + L"\" --mcp-stdio --config \"" + config + L"\"";
  for (const auto variable : {L"NODE_OPTIONS", L"NODE_PATH", L"NODE_REPL_EXTERNAL_MODULE", L"NODE_V8_COVERAGE",
      L"NODE_USE_ENV_PROXY", L"NODE_EXTRA_CA_CERTS", L"NODE_ICU_DATA", L"OPENSSL_CONF"}) { SetEnvironmentVariableW(variable, nullptr); }
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
