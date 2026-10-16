/**
 * @author Codex
 * @description Reads a current-user private exported MCP identity without accepting commands, bridge credentials or remote targets.
 */
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import type { NativeFileCommit } from '../runtime/basic/native-file-commit';
import { endpointSchema } from '../contracts/access';

const runtimeSchema = z.strictObject({
  url: endpointSchema,
  headers: z.strictObject({ Authorization: z.string().regex(/^Bearer [a-f0-9]{64}$/) }),
});
const metadata = {
  protocolVersion: z.literal('2025-11-25'),
  clientId: z.uuid(),
  scope: z.literal('device'),
};
const configSchema = z.union([
  z.strictObject({
    ...metadata,
    mcpServers: z.strictObject({
      'octopus-executor': runtimeSchema,
    }),
  }),
  z.strictObject({
    ...metadata,
    runtime: runtimeSchema,
    mcpServers: z.strictObject({
      'octopus-executor': z.strictObject({
        command: z.string().max(30000).refine(isAbsolute),
        args: z.tuple([
          z.literal('--mcp-stdio'),
          z.literal('--config'),
          z.string().max(30000).refine(isAbsolute),
        ]),
      }),
    }),
  }),
]);

/**
 * Loads the existing exported grant through the pinned native reader and refuses open ACLs or changed identities.
 * @throws When arguments, file protection, bounded content or loopback configuration are invalid.
 */
export async function readStdioConfig(native: NativeFileCommit, args: string[], launcher?: string) {
  if (args.length !== 3 || args[0] !== '--mcp-stdio' || args[1] !== '--config' || !isAbsolute(args[2]!)) {
    throw new Error('STDIO_CONFIG_ARGUMENTS');
  }
  const info = await native.inspect(args[2]!);
  if (!info.ok || info.directory || !info.privateAcl || info.links !== 1 || info.size > 65536) {
    throw new Error('STDIO_CONFIG_PROTECTION');
  }
  const read = await native.readSnapshot(args[2]!);
  if (
    !read.ok ||
    !read.privateAcl ||
    read.links !== 1 ||
    read.identity !== info.identity ||
    read.bytes.length > 65536
  ) {
    throw new Error('STDIO_CONFIG_CHANGED');
  }
  const config = configSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(read.bytes)));
  let server;
  if ('runtime' in config) {
    const executable = config.mcpServers['octopus-executor'];
    if (!launcher || executable.command !== launcher || executable.args[2] !== args[2]) {
      throw new Error('STDIO_CONFIG_LAUNCHER');
    }
    server = config.runtime;
  } else {
    server = config.mcpServers['octopus-executor'];
  }
  if (Number(new URL(server.url).port) > 65535) {
    throw new Error('STDIO_CONFIG_ENDPOINT');
  }
  return { endpoint: server.url, authorization: server.headers.Authorization };
}
