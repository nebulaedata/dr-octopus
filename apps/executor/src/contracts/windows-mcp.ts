/**
 * @author Codex
 * @description Defines owned stdio and loopback HTTP Windows-MCP selection without accepting executable commands or credentials in snapshots.
 */
import { z } from 'zod';

const endpointSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        ['https:', 'http:'].includes(url.protocol) &&
        ['127.0.0.1', '[::1]'].includes(url.hostname) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  }, 'Windows-MCP requires an HTTP(S) endpoint on numeric loopback without embedded credentials, query or fragment')
  .transform((value) => new URL(value).href);

export const windowsMcpSelectionSchema = z.discriminatedUnion('transport', [
  z.strictObject({ transport: z.literal('stdio') }),
  z
    .strictObject({
      transport: z.literal('http'),
      endpoint: endpointSchema,
      credentialId: z.uuid(),
      allowInsecureHttp: z.boolean().default(false),
    })
    .refine(
      (input) => !input.endpoint.startsWith('http:') || input.allowInsecureHttp,
      'HTTP requires explicit trusted-network approval'
    ),
]);

export type WindowsMcpSelection = z.infer<typeof windowsMcpSelectionSchema>;

export type WindowsMcpStatus = {
  transport: WindowsMcpSelection['transport'];
  state: 'connected' | 'failed' | 'closed';
  backendEpoch: string;
  protocolVersion: string | null;
  serverVersion: string;
  toolNames: string[];
  computerAvailable: false;
};
