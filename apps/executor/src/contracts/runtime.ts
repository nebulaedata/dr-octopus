/**
 * @author Codex
 * @description Defines serializable executor status and named desktop IPC contracts.
 */
import type { SettingsResponse, SettingsInput } from './connection-settings';
import { computerUseSchema, computerRuntimeStatusSchema } from './computer-use';
import { endpointSchema } from './access';
import type { ApprovalInput, AccessResponse } from './access';
import type {
  ClientConfigurationInput,
  ClientConfigurationResponse,
  ClientConfigurationActionResponse,
} from './client-configuration';
import { z } from 'zod';

export const developmentRestartExitCode = 75;

export const ipcChannels = {
  restartApplication: 'executor:application:restart',
  readAccess: 'executor:access:read',
  approveAccess: 'executor:access:approve',
  revokeAccess: 'executor:access:revoke',
  readClientConfiguration: 'executor:client-configuration:read',
  copyClientConfiguration: 'executor:client-configuration:copy',
  copyAgentGuide: 'executor:client-configuration:copy-agent-guide',
  downloadClientConfiguration: 'executor:client-configuration:download',
  readSettings: 'executor:connection-settings:read',
  saveSettings: 'executor:connection-settings:save',
  readStatus: 'executor:status:read',
  statusChanged: 'executor:status:changed',
  copyEndpoint: 'executor:connection:copy-endpoint',
  setBrowserEnabled: 'executor:browser:enable',
  browserDiagnostics: 'executor:browser:diagnostics',
  configureBrowserHost: 'executor:browser:configure-host',
  openBrowserExtensionFolder: 'executor:browser:open-extension-folder',
} as const;

export const capabilitySchema = z
  .object({
    available: z.boolean(),
    reason: z.string().max(200),
  })
  .strict();

export const runtimeSnapshotSchema = z
  .object({
    state: z.enum(['stopped', 'starting', 'ready', 'stopping', 'failed']),
    revision: z.number().int().nonnegative(),
    pid: z.number().int().positive().nullable(),
    startedAt: z.string().datetime().nullable(),
    message: z.string().max(200),
    computerUse: computerUseSchema.default({
      revision: 0,
      activityId: null,
      state: 'idle',
      activeCalls: 0,
      activeTasks: 0,
    }),
    health: z.strictObject({
      state: z.enum(['unknown', 'healthy', 'unresponsive']),
      checkedAt: z.string().datetime().nullable(),
    }),
    capabilities: z
      .object({ basic: capabilitySchema, browser: capabilitySchema, computer: computerRuntimeStatusSchema })
      .strict(),
  })
  .strict();

export const emptyRequestSchema = z.object({}).strict();
export const browserSelectionSchema = z.strictObject({ browser: z.enum(['chrome', 'edge']) });
export const runtimeMessageSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('ready'),
      pid: z.number().int().positive(),
      startedAt: z.string().datetime(),
      endpoint: endpointSchema,
      computer: computerRuntimeStatusSchema,
    })
    .strict(),
  z.object({ type: z.literal('shutdown') }).strict(),
]);

export const statusResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: runtimeSnapshotSchema }).strict(),
  z
    .object({
      ok: z.literal(false),
      code: z.enum(['FORBIDDEN', 'INVALID_REQUEST', 'UNAVAILABLE']),
      message: z.string().max(200),
    })
    .strict(),
]);

export type RuntimeSnapshot = z.infer<typeof runtimeSnapshotSchema>;
export type StatusResponse = z.infer<typeof statusResponseSchema>;

export const desktopActionResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), message: z.string().max(200) }),
]);
export type DesktopActionResponse = z.infer<typeof desktopActionResponseSchema>;
export const browserDiagnosticsSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    data: z.strictObject({
      resourceRoot: z.string().max(30000),
      projectRoot: z.string().max(30000),
      resourcesAvailable: z.boolean(),
    }),
  }),
  z.strictObject({ ok: z.literal(false), message: z.string().max(200) }),
]);
export type BrowserDiagnosticsResponse = z.infer<typeof browserDiagnosticsSchema>;

export interface ExecutorDesktopApi {
  /**
   * Requests a complete application restart with already saved settings and no executable arguments.
   */
  restartApplication(): Promise<DesktopActionResponse>;
  /**
   * Configures this installation's current-user Host using its bundled setup script.
   */
  configureBrowserHost(): Promise<DesktopActionResponse>;
  /**
   * Opens only the selected browser's bundled extension directory.
   */
  openBrowserExtensionFolder(input: z.infer<typeof browserSelectionSchema>): Promise<DesktopActionResponse>;
  /**
   * Reports fixed resource presence and local installation paths, never bootstrap contents or credentials.
   */
  browserDiagnostics(): Promise<BrowserDiagnosticsResponse>;
  /**
   * Persists explicit consent for browser bridge connections without enabling browser tools.
   */
  setBrowserEnabled(input: { enabled: boolean }): Promise<AccessResponse>;
  /**
   * Copies the authoritative live MCP address; accepts no arbitrary clipboard contents.
   */
  copyEndpoint(): Promise<DesktopActionResponse>;
  /**
   * Reads next-start listener settings and whether a restart is needed.
   */
  readSettings(): Promise<SettingsResponse>;
  /**
   * Persists next-start local/network listener choices without interrupting active tool calls.
   */
  saveSettings(input: SettingsInput): Promise<SettingsResponse>;

  /**
   * Lists safe connection summaries without credential material.
   */
  readAccess(): Promise<AccessResponse>;
  /**
   * Creates device capability approval and stores encrypted credentials without requiring a file download.
   */
  approveAccess(input: ApprovalInput): Promise<AccessResponse>;
  /**
   * Reads a credential-free preview for one active authorization and finite transport.
   */
  readClientConfiguration(input: ClientConfigurationInput): Promise<ClientConfigurationResponse>;
  /**
   * Copies one authoritative client configuration through Main without returning credentials to Renderer.
   */
  copyClientConfiguration(input: ClientConfigurationInput): Promise<ClientConfigurationActionResponse>;
  /**
   * Copies a Main-generated agent setup guide without exposing its credentials to Renderer.
   */
  copyAgentGuide(input: ClientConfigurationInput): Promise<ClientConfigurationActionResponse>;
  /**
   * Offers an optional private configuration download; cancellation does not revoke authorization.
   */
  downloadClientConfiguration(input: ClientConfigurationInput): Promise<ClientConfigurationActionResponse>;
  /**
   * Revokes one locally managed identity and drains its owned task.
   */
  revokeAccess(input: { clientId: string }): Promise<AccessResponse>;

  /**
   * Reads the current authoritative Runtime lifecycle status.
   */
  readStatus(): Promise<StatusResponse>;
  /**
   * Subscribes to status changes and returns an idempotent unsubscribe function.
   */
  onStatusChanged(listener: (snapshot: RuntimeSnapshot) => void): () => void;
}
