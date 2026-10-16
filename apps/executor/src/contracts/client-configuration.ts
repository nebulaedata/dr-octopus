/**
 * @author Codex
 * @description Defines finite client configuration actions whose previews never contain authorization credentials.
 */
import { z } from 'zod';

export const clientConfigurationInputSchema = z.strictObject({
  clientId: z.uuid(),
  transport: z.enum(['http', 'stdio', 'remote-http']),
});
export type ClientConfigurationInput = z.infer<typeof clientConfigurationInputSchema>;

export const clientConfigurationResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), data: z.strictObject({ preview: z.string().max(30000) }) }),
  z.strictObject({ ok: z.literal(false), message: z.string().max(200) }),
]);
export type ClientConfigurationResponse = z.infer<typeof clientConfigurationResponseSchema>;

export const clientConfigurationActionResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), cancelled: z.boolean() }),
  z.strictObject({ ok: z.literal(false), message: z.string().max(200) }),
]);
export type ClientConfigurationActionResponse = z.infer<typeof clientConfigurationActionResponseSchema>;
