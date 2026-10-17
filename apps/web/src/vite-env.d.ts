/**
 * @author Codex
 * @description Declares public Web environment variables exposed through Vite.
 */

/// <reference types="vite/client" />

declare const __OCTOPUS_RELEASE_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_EXECUTOR_VERSION?: string;
  readonly VITE_EXECUTOR_WINDOWS_INSTALLER_URL?: string;
  readonly VITE_EXECUTOR_WINDOWS_ZIP_URL?: string;
}
