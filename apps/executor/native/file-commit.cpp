/**
 * @author Codex
 * @description Provides finite asynchronous NTFS inspection, private recovery directories and no-clobber/backup publication.
 */
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <sddl.h>
#include <aclapi.h>
#include <bcrypt.h>
#include <delayimp.h>
#include <node_api.h>
#include <algorithm>
#include <memory>
#include <string>
#include <vector>
#include <cwctype>
#include <cmath>

/**
 * Resolves Node-API imports from the actual Node or Electron executable, without a Node executable dependency.
 */
static FARPROC WINAPI delayHook(unsigned notification, PDelayLoadInfo info) {
  if (notification == dliNotePreLoadLibrary && _stricmp(info->szDll, "node.exe") == 0) {
    return reinterpret_cast<FARPROC>(GetModuleHandleW(nullptr));
  }
  return nullptr;
}
extern "C" const PfnDliHook __pfnDliNotifyHook2 = delayHook;

struct Handle {
  HANDLE value;
  /**
   * Owns a handle until scope exit, including all exceptional paths.
   */
  explicit Handle(HANDLE handle) : value(handle) {}
  /**
   * Releases only this owned handle.
   */
  ~Handle() { if (value != INVALID_HANDLE_VALUE) { CloseHandle(value); } }
};
using Handles = std::vector<std::unique_ptr<Handle>>;

struct Info {
  std::string identity;
  DWORD links = 0;
  ULONGLONG size = 0;
  bool directory = false;
  bool privateAcl = false;
};
struct Work {
  enum Kind { Inspect, Recovery, Commit, ReadSnapshot, List, PrivateConfig, ReadDigest, TransferSnapshot, TransferDigest } kind;
  napi_async_work work = nullptr;
  napi_deferred deferred = nullptr;
  std::vector<std::wstring> args;
  DWORD error = ERROR_SUCCESS;
  bool started = false;
  Info info;
  std::vector<char> bytes;
  std::vector<WIN32_FIND_DATAW> entries;
  ULONGLONG expectedSize = 0;
  std::string digest;
};

struct HashOwner {
  BCRYPT_HASH_HANDLE hash = nullptr;
  /**
   * Releases only the per-file hash state; the Windows SHA-256 pseudo-handle is system-owned.
   */
  ~HashOwner() {
    if (hash) { BCryptDestroyHash(hash); }
  }
};

/**
 * Hashes exactly the declared bytes from the pinned read-only file handle with a fixed 64 KiB buffer.
 * Uses the Windows 10+ SHA-256 pseudo-handle to avoid provider loading for every file, retaining independent hash state.
 */
static DWORD readDigest(HANDLE handle, ULONGLONG expectedSize, std::string& digest) {
  HashOwner owner;
  if (BCryptCreateHash(BCRYPT_SHA256_ALG_HANDLE, &owner.hash, nullptr, 0, nullptr, 0, 0) < 0) { return ERROR_GEN_FAILURE; }
  std::vector<BYTE> bytes(65536);
  ULONGLONG position = 0;
  while (position < expectedSize) {
    DWORD count = 0;
    if (!ReadFile(handle, bytes.data(), static_cast<DWORD>(std::min<ULONGLONG>(bytes.size(), expectedSize - position)), &count, nullptr) || !count) {
      return ERROR_FILE_INVALID;
    }
    if (BCryptHashData(owner.hash, bytes.data(), count, 0) < 0) { return ERROR_GEN_FAILURE; }
    position += count;
  }
  LARGE_INTEGER size;
  if (!GetFileSizeEx(handle, &size) || static_cast<ULONGLONG>(size.QuadPart) != expectedSize) { return ERROR_FILE_INVALID; }
  BYTE result[32];
  if (BCryptFinishHash(owner.hash, result, sizeof(result), 0) < 0) { return ERROR_GEN_FAILURE; }
  constexpr char hex[] = "0123456789abcdef";
  for (const auto byte : result) { digest.push_back(hex[byte >> 4]); digest.push_back(hex[byte & 15]); }
  return ERROR_SUCCESS;
}

/**
 * Verifies a protected single-user full-access DACL before adopting persisted recovery metadata.
 */
static bool hasPrivateAcl(HANDLE handle) {
  PSECURITY_DESCRIPTOR descriptor = nullptr;
  PACL acl = nullptr;
  if (GetSecurityInfo(handle, SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, nullptr, nullptr, &acl, nullptr, &descriptor) != ERROR_SUCCESS) { return false; }
  SECURITY_DESCRIPTOR_CONTROL control;
  DWORD revision;
  bool valid = GetSecurityDescriptorControl(descriptor, &control, &revision) && (control & SE_DACL_PROTECTED) && acl && acl->AceCount == 1;
  HANDLE rawToken;
  if (valid && OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &rawToken)) {
    Handle token(rawToken);
    DWORD length = 0;
    GetTokenInformation(token.value, TokenUser, nullptr, 0, &length);
    std::vector<BYTE> bytes(length);
    if (!GetTokenInformation(token.value, TokenUser, bytes.data(), length, &length)) { valid = false; }
    else {
      ACCESS_ALLOWED_ACE* ace = nullptr;
      valid = GetAce(acl, 0, reinterpret_cast<void**>(&ace)) && ace->Header.AceType == ACCESS_ALLOWED_ACE_TYPE &&
        ace->Mask == FILE_ALL_ACCESS && EqualSid(&ace->SidStart, reinterpret_cast<TOKEN_USER*>(bytes.data())->User.Sid);
    }
  } else { valid = false; }
  LocalFree(descriptor);
  return valid;
}

/**
 * Validates an already-canonical ordinary absolute DOS path; callers cannot inject device/UNC/ADS namespaces.
 */
static bool validPath(const std::wstring& path) {
  if (path.size() < 3 || path.size() > 30000 || !iswalpha(path[0]) || path[1] != L':' || path[2] != L'\\') { return false; }
  for (size_t i = 2; i < path.size(); i++) {
    if (path[i] < 32 || std::wstring(L"/:*?\"<>|~").find(path[i]) != std::wstring::npos) { return false; }
  }
  size_t start = 3;
  while (start < path.size()) {
    const auto end = path.find(L'\\', start);
    const auto part = path.substr(start, end == std::wstring::npos ? end : end - start);
    if (part.empty() || part.back() == L'.' || part.back() == L' ') { return false; }
    auto name = part.substr(0, part.find(L'.'));
    std::transform(name.begin(), name.end(), name.begin(), towupper);
    if (name == L"CON" || name == L"PRN" || name == L"AUX" || name == L"NUL" ||
      (name.size() == 4 && (name.substr(0, 3) == L"COM" || name.substr(0, 3) == L"LPT") &&
       ((name[3] >= L'1' && name[3] <= L'9') || name[3] == L'¹' || name[3] == L'²' || name[3] == L'³'))) { return false; }
    if (end == std::wstring::npos) { break; }
    start = end + 1;
    if (start == path.size()) { return false; }
  }
  return true;
}

/**
 * Extends only validated local DOS paths for Win32 operations.
 */
static std::wstring extended(const std::wstring& path) { return L"\\\\?\\" + path; }

/**
 * Gets handle identity and rejects every reparse tag, non-disk object and non-NTFS volume.
 * Digest ancestor guards may omit unused ACL metadata; final objects and all private adoption still inspect it.
 */
static DWORD inspectHandle(HANDLE handle, Info& info, bool inspectPrivateAcl = true) {
  BY_HANDLE_FILE_INFORMATION stat{};
  if (!GetFileInformationByHandle(handle, &stat)) { return GetLastError(); }
  if (GetFileType(handle) != FILE_TYPE_DISK || (stat.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)) { return ERROR_NOT_SUPPORTED; }
  wchar_t filesystem[32]{};
  if (!GetVolumeInformationByHandleW(handle, nullptr, 0, nullptr, nullptr, nullptr, filesystem, 32)) { return GetLastError(); }
  if (_wcsicmp(filesystem, L"NTFS") != 0) { return ERROR_NOT_SUPPORTED; }
  const ULONGLONG fileId = (static_cast<ULONGLONG>(stat.nFileIndexHigh) << 32) | stat.nFileIndexLow;
  info.identity = std::to_string(stat.dwVolumeSerialNumber) + ":" + std::to_string(fileId);
  info.links = stat.nNumberOfLinks;
  info.size = (static_cast<ULONGLONG>(stat.nFileSizeHigh) << 32) | stat.nFileSizeLow;
  info.directory = (stat.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
  info.privateAcl = inspectPrivateAcl && hasPrivateAcl(handle);
  return ERROR_SUCCESS;
}

/**
 * Opens an object itself without following its reparse point, with deletion sharing only for ordinary inspection.
 */
static DWORD inspectPath(const std::wstring& path, Info& info) {
  Handle handle(CreateFileW(extended(path).c_str(), FILE_READ_ATTRIBUTES | READ_CONTROL,
    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING,
    FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
  if (handle.value == INVALID_HANDLE_VALUE) { return GetLastError(); }
  return inspectHandle(handle.value, info);
}

/**
 * Pins every ancestor directory without delete sharing until the operation completes.
 * This blocks directory rename during our call, while ordinary external file writes remain possible.
 * Omitting ACL metadata never omits NTFS/reparse/identity or sharing checks and is used only for digest guards.
 */
static DWORD guardAncestors(const std::wstring& path, Handles& guards, Info& parent, bool readonly = false, bool inspectPrivateAcl = true) {
  auto end = size_t(2);
  while (end != std::wstring::npos) {
    const auto ancestor = path.substr(0, end == 2 ? 3 : end);
    auto handle = std::make_unique<Handle>(CreateFileW(extended(ancestor).c_str(), FILE_READ_ATTRIBUTES | READ_CONTROL,
      readonly ? FILE_SHARE_READ : FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING,
      FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
    if (handle->value == INVALID_HANDLE_VALUE) { return GetLastError(); }
    const auto error = inspectHandle(handle->value, parent, inspectPrivateAcl);
    if (error != ERROR_SUCCESS) { return error; }
    if (!parent.directory) { return ERROR_DIRECTORY; }
    guards.push_back(std::move(handle));
    end = path.find(L'\\', end + 1);
  }
  return ERROR_SUCCESS;
}

/**
 * Creates a protected inheritable DACL restricted to the current process token's user SID.
 */
static DWORD privateSecurity(PSECURITY_DESCRIPTOR& descriptor) {
  HANDLE rawToken;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &rawToken)) { return GetLastError(); }
  Handle token(rawToken);
  DWORD length = 0;
  GetTokenInformation(token.value, TokenUser, nullptr, 0, &length);
  std::vector<BYTE> bytes(length);
  if (!GetTokenInformation(token.value, TokenUser, bytes.data(), length, &length)) { return GetLastError(); }
  LPWSTR sid = nullptr;
  if (!ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(bytes.data())->User.Sid, &sid)) { return GetLastError(); }
  const auto sddl = std::wstring(L"D:P(A;OICI;FA;;;") + sid + L")";
  LocalFree(sid);
  if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(), SDDL_REVISION_1, &descriptor, nullptr)) { return GetLastError(); }
  return ERROR_SUCCESS;
}

/**
 * Restricts a moved backup's DACL too: its old target permissions must not become recovery permissions.
 */
static DWORD protectBackup(const std::wstring& path) {
  PSECURITY_DESCRIPTOR descriptor = nullptr;
  auto error = privateSecurity(descriptor);
  if (error != ERROR_SUCCESS) { return error; }
  PACL acl = nullptr;
  BOOL present, defaulted;
  if (!GetSecurityDescriptorDacl(descriptor, &present, &acl, &defaulted)) { error = GetLastError(); }
  else { error = SetNamedSecurityInfoW(const_cast<wchar_t*>(extended(path).c_str()), SE_FILE_OBJECT,
    DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION, nullptr, nullptr, acl, nullptr); }
  LocalFree(descriptor);
  return error;
}

/**
 * Performs filesystem work off the JavaScript thread, reporting whether a publication primitive was entered.
 */
static void execute(napi_env, void* data) {
  auto& work = *static_cast<Work*>(data);
  try {
    Handles guards;
    Info parent;
    work.error = guardAncestors(work.args[0], guards, parent,
      work.kind == Work::ReadSnapshot || work.kind == Work::List || work.kind == Work::ReadDigest || work.kind == Work::TransferSnapshot || work.kind == Work::TransferDigest,
      work.kind != Work::ReadDigest);
    if (work.error != ERROR_SUCCESS) { return; }
    if (work.kind == Work::Inspect) { work.error = inspectPath(work.args[0], work.info); return; }
    if (work.kind == Work::PrivateConfig) {
      const auto& text = work.args[1];
      const int length = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, text.data(), static_cast<int>(text.size()), nullptr, 0, nullptr, nullptr);
      if (length <= 0 || length > 65536) { work.error = ERROR_INVALID_DATA; return; }
      work.bytes.resize(length);
      WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, text.data(), static_cast<int>(text.size()), work.bytes.data(), length, nullptr, nullptr);
      PSECURITY_DESCRIPTOR descriptor = nullptr;
      work.error = privateSecurity(descriptor);
      if (work.error != ERROR_SUCCESS) return;
      SECURITY_ATTRIBUTES security{sizeof(SECURITY_ATTRIBUTES), descriptor, FALSE};
      Handle file(CreateFileW(extended(work.args[0]).c_str(), GENERIC_WRITE | READ_CONTROL, 0, &security,
        CREATE_NEW, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
      LocalFree(descriptor);
      if (file.value == INVALID_HANDLE_VALUE) { work.error = GetLastError(); return; }
      work.started = true;
      work.error = inspectHandle(file.value, work.info);
      if (work.error != ERROR_SUCCESS || !work.info.privateAcl || work.info.directory || work.info.links != 1) {
        if (work.error == ERROR_SUCCESS) work.error = ERROR_ACCESS_DENIED;
        return;
      }
      DWORD written = 0;
      if (!WriteFile(file.value, work.bytes.data(), length, &written, nullptr) || written != static_cast<DWORD>(length) || !FlushFileBuffers(file.value)) {
        work.error = GetLastError(); if (!work.error) work.error = ERROR_WRITE_FAULT;
        return;
      }
      work.error = inspectHandle(file.value, work.info);
      return;
    }
    if (work.kind == Work::ReadSnapshot || work.kind == Work::List || work.kind == Work::ReadDigest || work.kind == Work::TransferSnapshot || work.kind == Work::TransferDigest) {
      // No write/delete sharing: scope ancestors and final object remain pinned through the whole read.
      Handle handle(CreateFileW(extended(work.args[0]).c_str(),
        GENERIC_READ | READ_CONTROL, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
      if (handle.value == INVALID_HANDLE_VALUE) { work.error = GetLastError(); return; }
      work.error = inspectHandle(handle.value, work.info);
      if (work.error != ERROR_SUCCESS) return;
      if (work.kind == Work::List) {
        if (!work.info.directory) { work.error = ERROR_DIRECTORY; return; }
        WIN32_FIND_DATAW entry{};
        HANDLE enumeration = FindFirstFileW((extended(work.args[0]) + L"\\*").c_str(), &entry);
        if (enumeration == INVALID_HANDLE_VALUE) {
          work.error = GetLastError() == ERROR_FILE_NOT_FOUND ? ERROR_SUCCESS : GetLastError(); return;
        }
        do {
          if (std::wstring(entry.cFileName) != L"." && std::wstring(entry.cFileName) != L"..")
            work.entries.push_back(entry);
          if (work.entries.size() >= 10001) break;
        } while (FindNextFileW(enumeration, &entry));
        DWORD enumerationError = GetLastError();
        FindClose(enumeration);
        if (work.entries.size() < 10001 && enumerationError != ERROR_NO_MORE_FILES)
          work.error = enumerationError;
        return;
      }
      if (work.info.directory || work.info.links != 1) { work.error = ERROR_NOT_SUPPORTED; return; }
      if (work.kind == Work::TransferSnapshot) {
        if (work.info.size != work.expectedSize) { work.error = ERROR_FILE_INVALID; return; }
        Info destinationParent;
        work.error = guardAncestors(work.args[1], guards, destinationParent);
        if (work.error != ERROR_SUCCESS || !destinationParent.privateAcl) {
          if (work.error == ERROR_SUCCESS) work.error = ERROR_ACCESS_DENIED;
          return;
        }
        PSECURITY_DESCRIPTOR descriptor = nullptr;
        work.error = privateSecurity(descriptor);
        if (work.error != ERROR_SUCCESS) return;
        SECURITY_ATTRIBUTES security{sizeof(SECURITY_ATTRIBUTES), descriptor, FALSE};
        Handle output(CreateFileW(extended(work.args[1]).c_str(), GENERIC_WRITE | READ_CONTROL, 0, &security,
          CREATE_NEW, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
        LocalFree(descriptor);
        if (output.value == INVALID_HANDLE_VALUE) { work.error = GetLastError(); return; }
        work.started = true;
        std::vector<char> buffer(1024 * 1024);
        ULONGLONG copied = 0;
        while (copied < work.info.size) {
          DWORD count = 0, written = 0;
          if (!ReadFile(handle.value, buffer.data(), static_cast<DWORD>(std::min<ULONGLONG>(buffer.size(), work.info.size - copied)), &count, nullptr) || !count ||
              !WriteFile(output.value, buffer.data(), count, &written, nullptr) || written != count) {
            work.error = ERROR_WRITE_FAULT; return;
          }
          copied += count;
        }
        if (!FlushFileBuffers(output.value)) { work.error = GetLastError(); return; }
        LARGE_INTEGER start{};
        if (!SetFilePointerEx(handle.value, start, nullptr, FILE_BEGIN)) { work.error = GetLastError(); return; }
        work.error = readDigest(handle.value, work.info.size, work.digest);
        return;
      }
      if (work.kind == Work::ReadDigest || work.kind == Work::TransferDigest) {
        if (work.info.size != work.expectedSize) { work.error = ERROR_FILE_INVALID; return; }
        work.error = readDigest(handle.value, work.expectedSize, work.digest);
        return;
      }
      if (work.info.size > 16ULL * 1024 * 1024) { work.error = ERROR_FILE_TOO_LARGE; return; }
      work.bytes.resize(static_cast<size_t>(work.info.size));
      size_t position = 0;
      while (position < work.bytes.size()) {
        DWORD count = 0;
        if (!ReadFile(handle.value, work.bytes.data() + position,
          static_cast<DWORD>(std::min<size_t>(65536, work.bytes.size() - position)), &count, nullptr) || !count) {
          work.error = ERROR_FILE_INVALID; return;
        }
        position += count;
      }
      return;
    }
    if (work.kind == Work::Recovery) {
      const auto name = work.args[0].substr(work.args[0].find_last_of(L'\\') + 1);
      const bool projectDirectory = name == L"device" || name == L"connections" || name == L"tasks" ||
        name == L"browser" || name == L"file-operations" || name == L"shell" ||
        name == L"transfers" || name == L"settings-recovery";
      if (!projectDirectory && name.find(L".octopus-executor-recovery-") != 0 &&
          name.find(L"octopus-executor-") != 0) { work.error = ERROR_INVALID_NAME; return; }
      PSECURITY_DESCRIPTOR descriptor = nullptr;
      work.error = privateSecurity(descriptor);
      if (work.error != ERROR_SUCCESS) { return; }
      SECURITY_ATTRIBUTES security{sizeof(SECURITY_ATTRIBUTES), descriptor, FALSE};
      if (!CreateDirectoryW(extended(work.args[0]).c_str(), &security)) { work.error = GetLastError(); }
      LocalFree(descriptor);
      if (work.error == ERROR_SUCCESS) { work.error = inspectPath(work.args[0], work.info); }
      return;
    }
    const auto& target = work.args[0];
    const auto& temp = work.args[1];
    const auto& backup = work.args[2];
    const std::wstring recovery = temp.substr(0, temp.find_last_of(L'\\'));
    const std::wstring targetParent = target.substr(0, target.find_last_of(L'\\'));
    const std::wstring backupParent = backup.substr(0, backup.find_last_of(L'\\'));
    if (recovery != backupParent || recovery.substr(0, recovery.find_last_of(L'\\')) != targetParent ||
      recovery.substr(recovery.find_last_of(L'\\') + 1).find(L".octopus-executor-recovery-") != 0 || temp == backup || target == temp) {
      work.error = ERROR_INVALID_PARAMETER; return;
    }
    Info recoveryInfo;
    work.error = guardAncestors(temp, guards, recoveryInfo);
    if (work.error != ERROR_SUCCESS) { return; }
    const auto wide = [](const std::string& value) { return std::wstring(value.begin(), value.end()); };
    if (wide(parent.identity) != work.args[4]) { work.error = ERROR_FILE_INVALID; return; }
    Info tempInfo, targetInfo, backupInfo;
    work.error = inspectPath(temp, tempInfo);
    if (work.error != ERROR_SUCCESS) { return; }
    if (tempInfo.directory || tempInfo.links != 1 || wide(tempInfo.identity) != work.args[5]) { work.error = ERROR_FILE_INVALID; return; }
    const auto backupError = inspectPath(backup, backupInfo);
    if (backupError != ERROR_FILE_NOT_FOUND) { work.error = ERROR_ALREADY_EXISTS; return; }
    const auto targetError = inspectPath(target, targetInfo);
    const bool create = work.args[3] == L"absent";
    if (create) {
      if (targetError != ERROR_FILE_NOT_FOUND) { work.error = ERROR_ALREADY_EXISTS; return; }
    } else {
      if (targetError != ERROR_SUCCESS) { work.error = targetError; return; }
      if (targetInfo.directory || targetInfo.links != 1 || wide(targetInfo.identity) != work.args[3]) { work.error = ERROR_FILE_INVALID; return; }
    }
    work.started = true;
    const BOOL published = create ? MoveFileExW(extended(temp).c_str(), extended(target).c_str(), 0) :
      ReplaceFileW(extended(target).c_str(), extended(temp).c_str(), extended(backup).c_str(), 0, nullptr, nullptr);
    if (!published) { work.error = GetLastError(); return; }
    if (!create) {
      work.error = protectBackup(backup);
      if (work.error != ERROR_SUCCESS) { return; }
    }
    work.error = inspectPath(target, work.info);
  } catch (...) { work.error = ERROR_NOT_ENOUGH_MEMORY; }
}

/**
 * Creates the finite result object without exposing paths or system messages.
 */
static void complete(napi_env env, napi_status status, void* data) {
  std::unique_ptr<Work> work(static_cast<Work*>(data));
  napi_value result, value;
  napi_create_object(env, &result);
  napi_get_boolean(env, status == napi_ok && work->error == ERROR_SUCCESS, &value);
  napi_set_named_property(env, result, "ok", value);
  napi_get_boolean(env, work->started, &value);
  napi_set_named_property(env, result, "started", value);
  napi_create_uint32(env, status == napi_ok ? work->error : ERROR_OPERATION_ABORTED, &value);
  napi_set_named_property(env, result, "nativeCode", value);
  napi_create_string_utf8(env, work->info.identity.c_str(), NAPI_AUTO_LENGTH, &value);
  napi_set_named_property(env, result, "identity", value);
  napi_create_uint32(env, work->info.links, &value);
  napi_set_named_property(env, result, "links", value);
  napi_create_double(env, static_cast<double>(work->info.size), &value);
  napi_set_named_property(env, result, "size", value);
  if (work->kind == Work::ReadDigest || work->kind == Work::TransferDigest || work->kind == Work::TransferSnapshot) {
    napi_create_string_utf8(env, work->digest.c_str(), work->digest.size(), &value);
    napi_set_named_property(env, result, "digest", value);
  }
  napi_get_boolean(env, work->info.directory, &value);
  napi_set_named_property(env, result, "directory", value);
  napi_get_boolean(env, work->info.privateAcl, &value);
  napi_set_named_property(env, result, "privateAcl", value);
  if (work->kind == Work::ReadSnapshot) {
    void* copied = nullptr;
    napi_create_buffer_copy(env, work->bytes.size(), work->bytes.data(), &copied, &value);
    napi_set_named_property(env, result, "bytes", value);
  }
  if (work->kind == Work::List) {
    napi_value entries;
    napi_create_array_with_length(env, work->entries.size(), &entries);
    for (size_t i = 0; i < work->entries.size(); ++i) {
      const auto& entry = work->entries[i];
      napi_value object;
      napi_create_object(env, &object);
      napi_create_string_utf16(env, reinterpret_cast<const char16_t*>(entry.cFileName), NAPI_AUTO_LENGTH, &value);
      napi_set_named_property(env, object, "name", value);
      napi_create_uint32(env, entry.dwFileAttributes, &value);
      napi_set_named_property(env, object, "attributes", value);
      napi_create_double(env, static_cast<double>((static_cast<ULONGLONG>(entry.nFileSizeHigh) << 32) | entry.nFileSizeLow), &value);
      napi_set_named_property(env, object, "size", value);
      napi_set_element(env, entries, static_cast<uint32_t>(i), object);
    }
    napi_set_named_property(env, result, "entries", entries);
  }
  napi_resolve_deferred(env, work->deferred, result);
  napi_delete_async_work(env, work->work);
}

/**
 * Validates primitive arguments and queues one finite named operation as a Promise.
 */
static napi_value queue(napi_env env, napi_callback_info info) {
  napi_value args[7];
  size_t count = 7;
  void* kindData;
  napi_get_cb_info(env, info, &count, args, nullptr, &kindData);
  const auto kind = static_cast<Work::Kind>(reinterpret_cast<uintptr_t>(kindData));
  size_t expected = 1;
  if (kind == Work::Commit) { expected = 6; }
  else if (kind == Work::TransferSnapshot) { expected = 3; }
  else if (kind == Work::PrivateConfig || kind == Work::ReadDigest || kind == Work::TransferDigest) { expected = 2; }
  size_t pathCount = 1;
  if (kind == Work::Commit) { pathCount = 3; }
  else if (kind == Work::TransferSnapshot) { pathCount = 2; }
  if (count != expected) { napi_throw_type_error(env, nullptr, "Invalid native operation arguments."); return nullptr; }
  auto work = std::make_unique<Work>();
  work->kind = kind;
  for (size_t i = 0; i < count; i++) {
    if (((kind == Work::ReadDigest || kind == Work::TransferDigest) && i == 1) || (kind == Work::TransferSnapshot && i == 2)) {
      double size;
      if (napi_get_value_double(env, args[i], &size) != napi_ok || !std::isfinite(size) ||
          size < 0 || size > (kind == Work::ReadDigest ? 67108864.0 : 2147483648.0) || std::floor(size) != size) {
        napi_throw_type_error(env, nullptr, "Native digest size must be an integer within the operation limit."); return nullptr;
      }
      work->expectedSize = static_cast<ULONGLONG>(size);
      continue;
    }
    size_t length = 0;
    if (napi_get_value_string_utf16(env, args[i], nullptr, 0, &length) != napi_ok || length == 0 || length > 30000) {
      napi_throw_type_error(env, nullptr, "Native arguments must be bounded strings."); return nullptr;
    }
    std::wstring argument(length + 1, L'\0');
    napi_get_value_string_utf16(env, args[i], reinterpret_cast<char16_t*>(argument.data()), length + 1, &length);
    argument.resize(length);
    if (argument.find(L'\0') != std::wstring::npos || (i < pathCount && !validPath(argument))) {
      napi_throw_type_error(env, nullptr, "Native paths must be canonical local DOS paths."); return nullptr;
    }
    work->args.push_back(std::move(argument));
  }
  napi_value promise, label;
  napi_create_string_utf8(env, "executor-file-commit", NAPI_AUTO_LENGTH, &label);
  napi_create_promise(env, &work->deferred, &promise);
  if (napi_create_async_work(env, nullptr, label, execute, complete, work.get(), &work->work) != napi_ok) {
    napi_throw_error(env, nullptr, "Cannot allocate native file operation."); return nullptr;
  }
  if (napi_queue_async_work(env, work->work) != napi_ok) {
    napi_delete_async_work(env, work->work);
    napi_throw_error(env, nullptr, "Cannot queue native file operation."); return nullptr;
  }
  work.release();
  return promise;
}

/**
 * Reads the current process authentication LUID and terminal session, without accepting a caller-selected token.
 */
static napi_value loginIdentity(napi_env env, napi_callback_info) {
  HANDLE rawToken;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &rawToken)) { napi_throw_error(env, nullptr, "Token unavailable"); return nullptr; }
  Handle token(rawToken);
  TOKEN_STATISTICS stats{};
  DWORD size;
  DWORD session;
  if (!GetTokenInformation(token.value, TokenStatistics, &stats, sizeof(stats), &size) ||
      !GetTokenInformation(token.value, TokenSessionId, &session, sizeof(session), &size)) {
    napi_throw_error(env, nullptr, "Login identity unavailable"); return nullptr;
  }
  const auto identity = std::to_string(stats.AuthenticationId.HighPart) + ":" +
    std::to_string(stats.AuthenticationId.LowPart) + ":" + std::to_string(session);
  napi_value result;
  napi_create_string_utf8(env, identity.c_str(), identity.size(), &result);
  return result;
}

/**
 * Exposes finite operations and the current process login identity, never a caller-selected token.
 */
static napi_value initialize(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    {"inspect", nullptr, queue, nullptr, nullptr, nullptr, napi_default, reinterpret_cast<void*>(Work::Inspect)},
    {"createRecovery", nullptr, queue, nullptr, nullptr, nullptr, napi_default, reinterpret_cast<void*>(Work::Recovery)},
    {"commit", nullptr, queue, nullptr, nullptr, nullptr, napi_default, reinterpret_cast<void*>(Work::Commit)},
    {"readSnapshot", nullptr, queue, nullptr, nullptr, nullptr, napi_default, reinterpret_cast<void*>(Work::ReadSnapshot)},
    {"list", nullptr, queue, nullptr, nullptr, nullptr, napi_default, reinterpret_cast<void*>(Work::List)},
    {"writePrivateConfig", nullptr, queue, nullptr, nullptr, nullptr, napi_default, reinterpret_cast<void*>(Work::PrivateConfig)},
    {"loginIdentity", nullptr, loginIdentity, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"readDigest", nullptr, queue, nullptr, nullptr, nullptr, napi_default, reinterpret_cast<void*>(Work::ReadDigest)},
    {"transferSnapshot", nullptr, queue, nullptr, nullptr, nullptr, napi_default, reinterpret_cast<void*>(Work::TransferSnapshot)},
    {"transferDigest", nullptr, queue, nullptr, nullptr, nullptr, napi_default, reinterpret_cast<void*>(Work::TransferDigest)}
  };
  napi_define_properties(env, exports, 10, properties);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
