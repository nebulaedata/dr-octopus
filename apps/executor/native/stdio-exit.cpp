/**
 * @author Codex
 * @description Provides only the stdio adapter's self-termination fallback when blocked Windows pipe writes prevent normal Node shutdown.
 */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <node_api.h>

/**
 * Ends only the calling process with a fixed failure status; accepts no PID, handle, command or exit code.
 */
static napi_value terminateCurrentProcess(napi_env env, napi_callback_info info) {
  size_t count = 1;
  napi_value argument;
  if (napi_get_cb_info(env, info, &count, &argument, nullptr, nullptr) != napi_ok || count != 0) {
    napi_throw_error(env, "STDIO_EXIT_ARGUMENTS", "Self-termination accepts no arguments.");
    return nullptr;
  }
  TerminateProcess(GetCurrentProcess(), 1);
  napi_throw_error(env, "STDIO_EXIT_FAILED", "Self-termination failed.");
  return nullptr;
}

/**
 * Exposes only one adapter-owned failure fallback, never a process-control API for tools or Renderer.
 */
static napi_value initialize(napi_env env, napi_value exports) {
  napi_property_descriptor method{"terminateCurrentProcess", nullptr, terminateCurrentProcess, nullptr, nullptr, nullptr, napi_default, nullptr};
  napi_define_properties(env, exports, 1, &method);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
