/**
 * @author Codex
 * @description Observes only physical plain Escape on an owned Windows hook thread, without capturing text, consuming input or exposing keyboard injection.
 */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <delayimp.h>
#include <node_api.h>
#include <atomic>
#include <thread>

/**
 * Resolves Node-API against the actual Electron or Node executable, never a system Node installation.
 */
static FARPROC WINAPI delayHook(unsigned notification, PDelayLoadInfo info) {
  if (notification == dliNotePreLoadLibrary && _stricmp(info->szDll, "node.exe") == 0) {
    return reinterpret_cast<FARPROC>(GetModuleHandleW(nullptr));
  }
  return nullptr;
}
extern "C" const PfnDliHook __pfnDliNotifyHook2 = delayHook;

enum class EscapeEvent : uintptr_t { ready = 1, unavailable = 2, pressed = 3 };
struct EscapeWatch {
  std::atomic<bool> active{true};
  std::atomic<DWORD> threadId{0};
  std::thread thread;
  napi_threadsafe_function callback = nullptr;
  napi_deferred ready = nullptr;
  HHOOK hook = nullptr;
  bool down = false;
};
struct EscapeOwner { EscapeWatch* watch = nullptr; };
static thread_local EscapeWatch* currentWatch = nullptr;

/**
 * Filters injected events and modifier shortcuts; repeated keydown never queues repeated stop requests.
 */
static LRESULT CALLBACK observeEscape(int code, WPARAM message, LPARAM data) {
  EscapeWatch* watch = currentWatch;
  if (code == HC_ACTION && watch && watch->active.load()) {
    const auto* key = reinterpret_cast<const KBDLLHOOKSTRUCT*>(data);
    if (key->vkCode == VK_ESCAPE && !(key->flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED))) {
      if (message == WM_KEYUP || message == WM_SYSKEYUP) {
        watch->down = false;
      } else if ((message == WM_KEYDOWN || message == WM_SYSKEYDOWN) && !watch->down) {
        watch->down = true;
        const int modifiers[] = {VK_CONTROL, VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN};
        bool modified = false;
        for (int modifier : modifiers) modified |= (GetAsyncKeyState(modifier) & 0x8000) != 0;
        if (!modified) {
          napi_call_threadsafe_function(watch->callback, reinterpret_cast<void*>(EscapeEvent::pressed), napi_tsfn_nonblocking);
        }
      }
    }
  }
  return CallNextHookEx(nullptr, code, message, data);
}

/**
 * Creates a message queue before publishing its thread identity so stop cannot lose a quit signal.
 */
static void runHook(EscapeWatch* watch) {
  MSG message;
  PeekMessageW(&message, nullptr, WM_USER, WM_USER, PM_NOREMOVE);
  watch->threadId.store(GetCurrentThreadId());
  if (!watch->active.load()) return;
  currentWatch = watch;
  HMODULE module = nullptr;
  GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
    reinterpret_cast<LPCWSTR>(&observeEscape), &module);
  watch->down = (GetAsyncKeyState(VK_ESCAPE) & 0x8000) != 0;
  watch->hook = SetWindowsHookExW(WH_KEYBOARD_LL, observeEscape, module, 0);
  if (!watch->hook) {
    napi_call_threadsafe_function(watch->callback, reinterpret_cast<void*>(EscapeEvent::unavailable), napi_tsfn_nonblocking);
    currentWatch = nullptr;
    return;
  }
  napi_call_threadsafe_function(watch->callback, reinterpret_cast<void*>(EscapeEvent::ready), napi_tsfn_nonblocking);
  while (watch->active.load() && GetMessageW(&message, nullptr, 0, 0) > 0) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }
  UnhookWindowsHookEx(watch->hook);
  watch->hook = nullptr;
  currentWatch = nullptr;
}

/**
 * Delivers only readiness and a no-argument Escape notification; retired callbacks cannot stop a newer activity.
 */
static void deliver(napi_env env, napi_value callback, void* context, void* data) {
  auto* watch = static_cast<EscapeWatch*>(context);
  if (!env || !watch->active.load()) return;
  const auto event = static_cast<EscapeEvent>(reinterpret_cast<uintptr_t>(data));
  napi_value value;
  if (event == EscapeEvent::ready && watch->ready) {
    napi_get_undefined(env, &value);
    napi_resolve_deferred(env, watch->ready, value);
    watch->ready = nullptr;
  } else if (event == EscapeEvent::unavailable && watch->ready) {
    napi_create_string_utf8(env, "COMPUTER_ESCAPE_UNAVAILABLE", NAPI_AUTO_LENGTH, &value);
    napi_value error;
    napi_create_error(env, nullptr, value, &error);
    napi_reject_deferred(env, watch->ready, error);
    watch->ready = nullptr;
  } else if (event == EscapeEvent::pressed) {
    napi_get_undefined(env, &value);
    napi_value result;
    napi_call_function(env, value, callback, 0, nullptr, &result);
  }
}

/**
 * Frees the callback context only after abort has drained all queued native notifications.
 */
static void finalizeWatch(napi_env, void* data, void*) { delete static_cast<EscapeWatch*>(data); }

/**
 * Retires only this hook and confirms its message thread exit before releasing the callback resource.
 */
static void stopWatch(EscapeOwner* owner, napi_env env) {
  EscapeWatch* watch = owner->watch;
  if (!watch) return;
  owner->watch = nullptr;
  watch->active.store(false);
  const DWORD threadId = watch->threadId.load();
  if (threadId) PostThreadMessageW(threadId, WM_QUIT, 0, 0);
  if (watch->thread.joinable()) watch->thread.join();
  if (env && watch->ready) {
    napi_value reason;
    napi_create_string_utf8(env, "COMPUTER_ESCAPE_CLOSED", NAPI_AUTO_LENGTH, &reason);
    napi_reject_deferred(env, watch->ready, reason);
    watch->ready = nullptr;
  }
  napi_release_threadsafe_function(watch->callback, napi_tsfn_abort);
}

/**
 * Starts one finite Escape-only watcher with an owned callback; no key, PID, window or command is accepted.
 */
static napi_value start(napi_env env, napi_callback_info info) {
  size_t count = 2;
  napi_value args[2];
  void* context;
  napi_get_cb_info(env, info, &count, args, nullptr, &context);
  auto* owner = static_cast<EscapeOwner*>(context);
  napi_valuetype type;
  if (count != 1 || napi_typeof(env, args[0], &type) != napi_ok || type != napi_function || owner->watch) {
    napi_throw_error(env, "COMPUTER_ESCAPE_ARGUMENTS", "One callback and no existing Escape watcher are required.");
    return nullptr;
  }
  auto* watch = new EscapeWatch();
  napi_value promise, name;
  napi_create_promise(env, &watch->ready, &promise);
  napi_create_string_utf8(env, "Executor physical Escape", NAPI_AUTO_LENGTH, &name);
  if (napi_create_threadsafe_function(env, args[0], nullptr, name, 2, 1, watch, finalizeWatch,
      watch, deliver, &watch->callback) != napi_ok) {
    delete watch;
    napi_throw_error(env, "COMPUTER_ESCAPE_UNAVAILABLE", "Escape notification resource could not be created.");
    return nullptr;
  }
  napi_unref_threadsafe_function(env, watch->callback);
  owner->watch = watch;
  try { watch->thread = std::thread(runHook, watch); }
  catch (...) { stopWatch(owner, env); }
  return promise;
}

/**
 * Removes only the calling environment's watcher; repeated stop is harmless.
 */
static napi_value stop(napi_env env, napi_callback_info info) {
  size_t count = 1;
  napi_value arg;
  void* context;
  napi_get_cb_info(env, info, &count, &arg, nullptr, &context);
  if (count != 0) {
    napi_throw_error(env, "COMPUTER_ESCAPE_ARGUMENTS", "Escape stop accepts no arguments.");
    return nullptr;
  }
  stopWatch(static_cast<EscapeOwner*>(context), env);
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

/**
 * Releases native resources when Node/Electron ends even if the JavaScript owner could not dispose.
 */
static void cleanup(void* data) {
  auto* owner = static_cast<EscapeOwner*>(data);
  stopWatch(owner, nullptr);
  delete owner;
}

/**
 * Exposes a watcher pair with automatic environment cleanup, never a keyboard-control API.
 */
static napi_value initialize(napi_env env, napi_value exports) {
  auto* owner = new EscapeOwner();
  napi_add_env_cleanup_hook(env, cleanup, owner);
  napi_property_descriptor methods[] = {
    {"start", nullptr, start, nullptr, nullptr, nullptr, napi_default, owner},
    {"stop", nullptr, stop, nullptr, nullptr, nullptr, napi_default, owner},
  };
  napi_define_properties(env, exports, 2, methods);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
