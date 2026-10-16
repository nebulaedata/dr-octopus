/**
 * @author Codex
 * @description Adapts the named Preload API and rejects invalid Runtime DTOs.
 */
import {
  statusResponseSchema,
  desktopActionResponseSchema,
  browserDiagnosticsSchema,
} from '../../../contracts/runtime';
import type { ExecutorDesktopApi, RuntimeSnapshot } from '../../../contracts/runtime';
import { accessResponseSchema } from '../../../contracts/access';
import type { ApprovalInput, AccessSnapshot } from '../../../contracts/access';
import {
  clientConfigurationResponseSchema,
  clientConfigurationActionResponseSchema,
} from '../../../contracts/client-configuration';
import type { ClientConfigurationInput } from '../../../contracts/client-configuration';

/**
 * Rejects missing desktop capabilities and exposes only detached safe Host replies.
 */
function desktop(): ExecutorDesktopApi {
  if (!window.executor) {
    throw new Error('请从执行器应用打开此界面');
  }
  return window.executor;
}
/**
 * Requests a complete restart without exposing process paths or arbitrary launch arguments.
 */
export async function restartApplication(): Promise<void> {
  const result = desktopActionResponseSchema.parse(await desktop().restartApplication());
  if (!result.ok) {
    throw new Error(result.message);
  }
}
/**
 * Configures only the current installation's Browser Host without exposing script execution.
 */
export async function configureBrowserHost(): Promise<void> {
  const reply = desktopActionResponseSchema.parse(await desktop().configureBrowserHost());
  if (!reply.ok) {
    throw new Error(reply.message);
  }
}
/**
 * Opens the selected bundled extension directory through the finite Main action.
 */
export async function openBrowserExtensionFolder(browser: 'chrome' | 'edge'): Promise<void> {
  const reply = desktopActionResponseSchema.parse(await desktop().openBrowserExtensionFolder({ browser }));
  if (!reply.ok) {
    throw new Error(reply.message);
  }
}
/**
 * Saves explicit browser connection consent through Main, returning no credentials.
 */
export async function setBrowserEnabled(enabled: boolean): Promise<AccessSnapshot> {
  const reply = accessResponseSchema.parse(await desktop().setBrowserEnabled({ enabled }));
  if (!reply.ok) {
    throw new Error(reply.message);
  }
  return reply.data;
}
/**
 * Reports only trusted local installation locations and fixed resource presence.
 */
export async function browserDiagnostics() {
  const reply = browserDiagnosticsSchema.parse(await desktop().browserDiagnostics());
  if (!reply.ok) {
    throw new Error(reply.message);
  }
  return reply.data;
}

/**
 * Copies only the current live endpoint via Main's finite clipboard action.
 */
export async function copyEndpoint(): Promise<void> {
  const result = desktopActionResponseSchema.parse(await desktop().copyEndpoint());
  if (!result.ok) {
    throw new Error(result.message);
  }
}

/**
 * Reads the current trusted Host authorization list without credentials.
 */
export async function readAccess(): Promise<AccessSnapshot> {
  const reply = accessResponseSchema.parse(await desktop().readAccess());
  if (!reply.ok) {
    throw new Error(reply.message);
  }
  return reply.data;
}

/**
 * Creates a grant without forcing a configuration download.
 */
export async function approveAccess(input: ApprovalInput): Promise<AccessSnapshot> {
  const reply = accessResponseSchema.parse(await desktop().approveAccess(input));
  if (!reply.ok) {
    throw new Error(reply.message);
  }
  return reply.data;
}

/**
 * Reads only a safe placeholder preview for an active grant.
 */
export async function readClientConfiguration(input: ClientConfigurationInput): Promise<string> {
  const reply = clientConfigurationResponseSchema.parse(await desktop().readClientConfiguration(input));
  if (!reply.ok) {
    throw new Error(reply.message);
  }
  return reply.data.preview;
}

/**
 * Copies a complete configuration through Main; the returned boolean contains no credentials.
 */
export async function copyClientConfiguration(input: ClientConfigurationInput): Promise<boolean> {
  const reply = clientConfigurationActionResponseSchema.parse(await desktop().copyClientConfiguration(input));
  if (!reply.ok) {
    throw new Error(reply.message);
  }
  return !reply.cancelled;
}

/**
 * Requests a credential-bearing guide directly to the clipboard; only the outcome returns to the page.
 */
export async function copyAgentGuide(input: ClientConfigurationInput): Promise<boolean> {
  const reply = clientConfigurationActionResponseSchema.parse(await desktop().copyAgentGuide(input));
  if (!reply.ok) {
    throw new Error(reply.message);
  }
  return !reply.cancelled;
}

/**
 * Downloads configuration separately; cancellation is a normal result and preserves the grant.
 */
export async function downloadClientConfiguration(input: ClientConfigurationInput): Promise<boolean> {
  const reply = clientConfigurationActionResponseSchema.parse(
    await desktop().downloadClientConfiguration(input)
  );
  if (!reply.ok) {
    throw new Error(reply.message);
  }
  return !reply.cancelled;
}

/**
 * Revokes one managed client and returns the confirmed Host snapshot.
 */
export async function revokeAccess(clientId: string): Promise<AccessSnapshot> {
  const reply = accessResponseSchema.parse(await desktop().revokeAccess({ clientId }));
  if (!reply.ok) {
    throw new Error(reply.message);
  }
  return reply.data;
}

declare global {
  interface Window {
    executor?: ExecutorDesktopApi;
  }
}

/**
 * Reads an authoritative snapshot or a safe user-facing error.
 */
export async function readRuntimeStatus(): Promise<RuntimeSnapshot> {
  if (!window.executor) {
    throw new Error('请从执行器应用打开此界面');
  }
  const response = statusResponseSchema.parse(await window.executor.readStatus());
  if (!response.ok) {
    throw new Error(response.message);
  }
  return response.data;
}
