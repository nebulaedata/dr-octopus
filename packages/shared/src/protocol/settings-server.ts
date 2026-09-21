/**
 * @author Codex
 * @description Defines the public Server configuration and manual restart contracts.
 */
import { z } from 'zod';
import { UpdateEnvironmentBodySchema } from './settings-environment.js';

export const serverSettingKeys = [
  'SERVER_HOST',
  'SERVER_PORT',
  'SERVER_CORS_ORIGIN',
  'SERVER_MAX_ACTIVE_RUNTIMES_PER_WORKSPACE',
  'SERVER_MAX_ACTIVE_RUNTIMES',
  'SERVER_FILE_LOG_ENABLED',
  'SERVER_FILE_LOG_LEVEL',
  'SERVER_FILE_LOG_MAX_SIZE_MB',
  'SERVER_FILE_LOG_RETENTION_DAYS',
  'SERVER_FILE_LOG_MAX_FILES',
  'SERVER_FILE_LOG_MAX_TOTAL_SIZE_MB',
  'SERVER_FILE_LOG_REQUIRED',
] as const;
export type ServerSettingKey = (typeof serverSettingKeys)[number];
export const UpdateServerSettingsSchema = UpdateEnvironmentBodySchema.refine(
  ({ changes }) => Object.keys(changes).every((key) => serverSettingKeys.includes(key as ServerSettingKey)),
  'Unknown Server setting'
);
export const RestartServerSchema = z
  .object({
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    expectedServiceInstanceId: z.uuid(),
  })
  .strict();
export type RestartServerBody = z.infer<typeof RestartServerSchema>;
export const RestartKeySchema = z.string().regex(/^[\x20-\x7e]{1,128}$/);
const source = z.enum(['process', 'dotenv', 'file', 'default', 'override', 'host']);
/**
 * Retains storage intent separately from typed effective configuration.
 */
function field<T extends z.ZodType>(value: T) {
  const resolved = z.object({ configured: z.boolean(), value: value.nullable() });
  return z.object({
    stored: z.object({ configured: z.boolean(), value: z.string().nullable() }),
    current: resolved,
    next: resolved,
    source,
    overridden: z.boolean(),
  });
}
export const ServerSettingsSchema = z.object({
  revision: z.string(),
  serviceInstanceId: z.uuid(),
  fields: z.object({
    SERVER_HOST: field(z.string()),
    SERVER_PORT: field(z.number()),
    SERVER_CORS_ORIGIN: field(z.string()),
    SERVER_MAX_ACTIVE_RUNTIMES_PER_WORKSPACE: field(z.number()),
    SERVER_MAX_ACTIVE_RUNTIMES: field(z.number()),
    SERVER_FILE_LOG_ENABLED: field(z.boolean()),
    SERVER_FILE_LOG_LEVEL: field(z.string()),
    SERVER_FILE_LOG_MAX_SIZE_MB: field(z.number()),
    SERVER_FILE_LOG_RETENTION_DAYS: field(z.number()),
    SERVER_FILE_LOG_MAX_FILES: field(z.number()),
    SERVER_FILE_LOG_MAX_TOTAL_SIZE_MB: field(z.number()),
    SERVER_FILE_LOG_REQUIRED: field(z.boolean()),
  }),
  pendingRestartFields: z.array(z.enum(serverSettingKeys)),
  additionalPendingRestart: z.boolean(),
  prediction: z.enum(['known', 'host_managed']),
  diagnostics: z.array(z.string()),
  runtime: z.object({
    state: z.enum(['running', 'restarting', 'stopping', 'failed']),
    address: z.string().nullable(),
    activeRuntimeCount: z.number(),
    fileLogging: z.object({ enabled: z.boolean(), state: z.string(), directory: z.string() }),
  }),
  capabilities: z.object({ edit: z.boolean(), restart: z.boolean(), reason: z.string().nullable() }),
});
export type ServerSettingsDto = z.infer<typeof ServerSettingsSchema>;
export const RestartOperationSchema = z.object({
  operationId: z.uuid(),
  state: z.enum([
    'accepted',
    'draining',
    'starting',
    'restoring',
    'succeeded',
    'restored',
    'failed',
    'cancelled',
  ]),
  sourceInstanceId: z.uuid(),
  targetInstanceId: z.uuid().nullable(),
  targetRevision: z.string(),
  actualAddress: z.string().nullable(),
  acceptedAt: z.string(),
  completedAt: z.string().nullable(),
  access: z.object({
    kind: z.enum(['same_origin', 'port_changed', 'local_only', 'deployment_managed']),
    port: z.number(),
    loopbackUrl: z.string().nullable(),
  }),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
});
export type RestartOperationDto = z.infer<typeof RestartOperationSchema>;
export interface SaveServerSettingsResponse {
  settings: ServerSettingsDto;
  outcome: 'applied' | 'unchanged';
  warnings: { code: string; message: string; nextAction: 'none' | 'restart_service' }[];
  effect: { kind: 'server_restart'; currentServer: 'unchanged'; requiredAction: 'none' | 'restart_service' };
}
