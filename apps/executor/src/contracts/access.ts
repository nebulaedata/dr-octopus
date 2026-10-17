/**
 * @author Codex
 * @description Defines device-scoped capability grants; renderer requests cannot supply filesystem scopes or receive credentials.
 */
import { z } from 'zod';
import { computerRuntimeStatusSchema } from './computer-use';
import { deviceIdentitySchema } from './device-identity';
import { browserBridgeSnapshotSchema } from '@octopus/shared/protocol/browser-bridge';
import { networkAddressSchema } from './connection-settings';
export const endpointSchema = z.string().regex(/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/mcp$/);
export const remoteEndpointSchema = z
  .string()
  .max(100)
  .refine((value) => {
    const match = /^http:\/\/([0-9.]+):([1-9][0-9]{0,4})\/mcp$/.exec(value);
    return !!match && networkAddressSchema.safeParse(match[1]).success && Number(match[2]) <= 65535;
  });
export const revokeInputSchema = z.strictObject({ clientId: z.uuid() });
export const basicPermissionSchema = z.enum(['files.read', 'files.write', 'shell.execute']);
export const executorPermissionSchema = z.enum([
  'files.read',
  'files.write',
  'shell.execute',
  'browser',
  'computer.control',
]);
export const approvalInputSchema = z.strictObject({
  label: z.string().trim().min(1).max(100),
  permissions: z
    .array(executorPermissionSchema)
    .min(1)
    .max(6)
    .refine((values) => new Set(values).size === values.length),
  waitBudgetMs: z.number().int().min(30000).max(610000),
});
export const clientSummarySchema = z.strictObject({
  clientId: z.uuid(),
  scope: z.literal('device'),
  label: z.string().max(100),
  permissions: z.array(executorPermissionSchema).max(6),
  waitBudgetMs: z.number().int(),
  revoked: z.boolean(),
});
export const accessSnapshotSchema = z.strictObject({
  toolCatalog: z
    .strictObject({
      basic: z.array(z.string().max(100)).max(100),
      control: z.array(z.string().max(100)).max(100),
      transfer: z.array(z.string().max(100)).max(100),
      browser: z.array(z.string().max(100)).max(100),
      computer: z.array(z.string().max(100)).max(100),
    })
    .optional(),
  device: deviceIdentitySchema,
  endpoint: endpointSchema.nullable(),
  remoteEndpoint: remoteEndpointSchema.nullable(),
  browser: browserBridgeSnapshotSchema,
  clients: z.array(clientSummarySchema).max(100),
  connections: z
    .array(z.strictObject({ clientId: z.uuid(), sessions: z.number().int().min(1).max(32) }))
    .max(32),
});
export const accessResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), data: accessSnapshotSchema }),
  z.strictObject({ ok: z.literal(false), code: z.string().max(100), message: z.string().max(200) }),
]);
export type ExecutorPermission = z.infer<typeof executorPermissionSchema>;
export type ApprovalInput = z.infer<typeof approvalInputSchema>;
export type AccessSnapshot = z.infer<typeof accessSnapshotSchema>;
export type AccessResponse = z.infer<typeof accessResponseSchema>;

export const hostRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('browser-enable'), requestId: z.uuid(), enabled: z.boolean() }),
  z.strictObject({ type: z.literal('access-list'), requestId: z.uuid() }),
  z.strictObject({
    type: z.literal('access-approve'),
    requestId: z.uuid(),
    input: approvalInputSchema,
  }),
  z.strictObject({ type: z.literal('access-revoke'), requestId: z.uuid(), clientId: z.uuid() }),
]);
export const hostReplySchema = z.strictObject({
  type: z.literal('access-reply'),
  requestId: z.uuid(),
  response: accessResponseSchema,
  computer: computerRuntimeStatusSchema,
  credential: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  clientId: z.uuid().optional(),
});
