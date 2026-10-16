/**
 * @author Codex
 * @description Defines the local executor instance identity without granting device access.
 */
import { z } from 'zod';

export const deviceNameSchema = z
  .string()
  .refine((name) => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name), '设备名称不能包含换行或控制字符')
  .trim()
  .refine(
    (name) => [...name].length >= 1 && [...name].length <= 64 && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name),
    '设备名称需为 1–64 个字符，不能包含换行或控制字符'
  );
export const deviceIdentitySchema = z.strictObject({
  deviceId: z.uuidv4(),
  deviceName: deviceNameSchema,
});
export type DeviceIdentity = z.infer<typeof deviceIdentitySchema>;

/**
 * Returns a rename-stable ASCII client connection key using the complete instance ID.
 */
export function deviceConnectionKey(device: DeviceIdentity): string {
  return `octo${deviceIdentitySchema.parse(device).deviceId.replaceAll('-', '')}`;
}
