/**
 * @author Codex
 * @description Defines immediate theme and window preferences plus next-start connection settings without granting transport or credential access.
 */
import { z } from 'zod';
import { deviceIdentitySchema, deviceNameSchema } from './device-identity';
import { defaultTransferSettings, transferSettingsSchema } from './transfer-settings';

// Restrict explicit plaintext access to numeric private/VPN addresses, never wildcard or DNS.
export const networkAddressSchema = z.ipv4().refine((address) => {
  const [first, second] = address.split('.').map(Number);
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127)
  );
}, '请填写内网或 VPN IPv4 地址');
export const networkAddressesSchema = z
  .array(
    z.strictObject({
      address: networkAddressSchema,
      interfaceName: z.string().min(1).max(1024),
    })
  )
  .max(256);
export const networkAddressesResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), data: networkAddressesSchema }),
  z.strictObject({
    ok: z.literal(false),
    code: z.enum(['FORBIDDEN', 'INVALID_REQUEST', 'UNAVAILABLE']),
    message: z.string().max(200),
  }),
]);
export type NetworkAddress = z.infer<typeof networkAddressesSchema>[number];
export type NetworkAddressesResponse = z.infer<typeof networkAddressesResponseSchema>;

export const themeSourceSchema = z.enum(['system', 'light', 'dark']);
export const closeBehaviorSchema = z.enum(['exit', 'taskbar', 'tray']);
export const settingsInputSchema = z.strictObject({
  transfer: transferSettingsSchema.default(defaultTransferSettings),
  deviceName: deviceNameSchema.optional(),
  themeSource: themeSourceSchema.default('system'),
  closeBehavior: closeBehaviorSchema.default('tray'),
  port: z.number().int().min(1).max(65535),
  networkAddress: networkAddressSchema.nullable(),
});
export type SettingsInput = z.infer<typeof settingsInputSchema>;
export const connectionSettingsSchema = z.strictObject({
  transfer: transferSettingsSchema,
  device: deviceIdentitySchema,
  deviceName: deviceNameSchema,
  themeSource: themeSourceSchema,
  closeBehavior: closeBehaviorSchema,
  port: z.number().int().min(1).max(65535),
  networkAddress: networkAddressSchema.nullable(),
  pendingRestart: z.boolean(),
});
export const settingsResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), data: connectionSettingsSchema }),
  z.strictObject({
    ok: z.literal(false),
    code: z.enum(['FORBIDDEN', 'INVALID_REQUEST', 'UNAVAILABLE']),
    message: z.string().max(200),
  }),
]);
export type SettingsResponse = z.infer<typeof settingsResponseSchema>;
