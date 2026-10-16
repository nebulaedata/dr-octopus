/**
 * @author Codex
 * @description Exposes validated named management actions and cancellable status subscriptions to the sandbox Renderer without credentials or generic IPC.
 */
import { contextBridge, ipcRenderer } from 'electron';
import {
  ipcChannels,
  runtimeSnapshotSchema,
  statusResponseSchema,
  desktopActionResponseSchema,
  browserDiagnosticsSchema,
  browserSelectionSchema,
} from '../contracts/runtime';
import type { ExecutorDesktopApi } from '../contracts/runtime';
import { settingsResponseSchema, settingsInputSchema } from '../contracts/connection-settings';
import { accessResponseSchema, approvalInputSchema, revokeInputSchema } from '../contracts/access';
import { z } from 'zod';
import {
  clientConfigurationInputSchema,
  clientConfigurationResponseSchema,
  clientConfigurationActionResponseSchema,
} from '../contracts/client-configuration';

const api: ExecutorDesktopApi = {
  /**
   * Requests only the fixed application restart operation through the trusted Main.
   */
  async restartApplication() {
    return desktopActionResponseSchema.parse(await ipcRenderer.invoke(ipcChannels.restartApplication, {}));
  },
  /**
   * Requests fixed current-user setup without accepting scripts or filesystem paths.
   */
  async configureBrowserHost() {
    return desktopActionResponseSchema.parse(await ipcRenderer.invoke(ipcChannels.configureBrowserHost, {}));
  },
  /**
   * Requests the finite browser-specific extension folder from Main.
   */
  async openBrowserExtensionFolder(input) {
    return desktopActionResponseSchema.parse(
      await ipcRenderer.invoke(ipcChannels.openBrowserExtensionFolder, browserSelectionSchema.parse(input))
    );
  },
  /**
   * Requests finite local installation diagnostics without accepting paths.
   */
  async browserDiagnostics() {
    return browserDiagnosticsSchema.parse(await ipcRenderer.invoke(ipcChannels.browserDiagnostics, {}));
  },
  /**
   * Sends only an explicit validated browser connection choice to the trusted Main.
   */
  async setBrowserEnabled(input) {
    return accessResponseSchema.parse(
      await ipcRenderer.invoke(
        ipcChannels.setBrowserEnabled,
        z.strictObject({ enabled: z.boolean() }).parse(input)
      )
    );
  },
  /**
   * Copies the Runtime-selected endpoint without exposing clipboard access.
   */
  async copyEndpoint() {
    return desktopActionResponseSchema.parse(await ipcRenderer.invoke(ipcChannels.copyEndpoint, {}));
  },
  /**
   * Reads only safe persisted connection settings.
   */
  async readSettings() {
    return settingsResponseSchema.parse(await ipcRenderer.invoke(ipcChannels.readSettings, {}));
  },
  /**
   * Saves explicit validated listener settings for the next start through the trusted Main.
   */
  async saveSettings(input) {
    return settingsResponseSchema.parse(
      await ipcRenderer.invoke(ipcChannels.saveSettings, settingsInputSchema.parse(input))
    );
  },

  /**
   * Reads safe Host-managed connection metadata.
   */
  async readAccess() {
    return accessResponseSchema.parse(await ipcRenderer.invoke(ipcChannels.readAccess, {}));
  },
  /**
   * Creates an authorization without exposing a path or token interface.
   */
  async approveAccess(input) {
    return accessResponseSchema.parse(
      await ipcRenderer.invoke(ipcChannels.approveAccess, approvalInputSchema.parse(input))
    );
  },
  /**
   * Requests a placeholder-only preview for an explicit authorization and transport.
   */
  async readClientConfiguration(input) {
    return clientConfigurationResponseSchema.parse(
      await ipcRenderer.invoke(
        ipcChannels.readClientConfiguration,
        clientConfigurationInputSchema.parse(input)
      )
    );
  },
  /**
   * Copies only Main-built configuration, accepting no arbitrary clipboard payload.
   */
  async copyClientConfiguration(input) {
    return clientConfigurationActionResponseSchema.parse(
      await ipcRenderer.invoke(
        ipcChannels.copyClientConfiguration,
        clientConfigurationInputSchema.parse(input)
      )
    );
  },
  /**
   * Copies only the trusted transport-specific guide; callers cannot provide clipboard text.
   */
  async copyAgentGuide(input) {
    return clientConfigurationActionResponseSchema.parse(
      await ipcRenderer.invoke(ipcChannels.copyAgentGuide, clientConfigurationInputSchema.parse(input))
    );
  },
  /**
   * Downloads configuration only after an explicit separate user action.
   */
  async downloadClientConfiguration(input) {
    return clientConfigurationActionResponseSchema.parse(
      await ipcRenderer.invoke(
        ipcChannels.downloadClientConfiguration,
        clientConfigurationInputSchema.parse(input)
      )
    );
  },
  /**
   * Revokes exactly one validated identity through the trusted Host.
   */
  async revokeAccess(input) {
    return accessResponseSchema.parse(
      await ipcRenderer.invoke(ipcChannels.revokeAccess, revokeInputSchema.parse(input))
    );
  },
  /**
   * Validates the reply without exposing raw IPC to the Renderer.
   */
  async readStatus() {
    return statusResponseSchema.parse(await ipcRenderer.invoke(ipcChannels.readStatus, {}));
  },
  /**
   * Keeps Electron events private and removes only this subscription's listener.
   */
  onStatusChanged(listener) {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const result = runtimeSnapshotSchema.safeParse(value);
      if (result.success) {
        listener(result.data);
      }
    };
    ipcRenderer.on(ipcChannels.statusChanged, handler);
    return () => {
      ipcRenderer.removeListener(ipcChannels.statusChanged, handler);
    };
  },
};

contextBridge.exposeInMainWorld('executor', api);
