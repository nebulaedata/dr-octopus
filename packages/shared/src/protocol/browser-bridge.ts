/**
 * @author Codex
 * @description Defines finite versioned Browser handshakes and requests without platform dependencies.
 */
import { z } from 'zod';
import { browserCommandSchema, browserResultSchema } from './browser-tools.js';

export const browserHostName = 'com.octopus.executor.browser';
export const bridgeVersion = 3;
export const bridgeFrameLimit = 256 * 1024;

export const bridgeHelloSchema = z
  .strictObject({
    type: z.literal('hello'),
    requestId: z.uuid(),
    version: z.number().int().min(1).max(1000),
    installationId: z.uuid(),
    browser: z.enum(['chrome', 'edge']),
    tools: z.boolean().optional(),
    extensionVersion: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/)
      .max(30),
  })
  .refine((value) => value.version !== bridgeVersion || value.tools === true, {
    message: 'The current bridge version requires finite tool capability.',
  });
export const extensionMessageSchema = z.union([
  browserResultSchema,
  z.discriminatedUnion('type', [
    bridgeHelloSchema,
    z.strictObject({ type: z.literal('heartbeat'), requestId: z.uuid(), connectionId: z.uuid() }),
  ]),
]);
export const hostMessageSchema = z.union([
  browserCommandSchema,
  z.discriminatedUnion('type', [
    z.strictObject({
      type: z.literal('connected'),
      requestId: z.uuid(),
      version: z.literal(bridgeVersion),
      connectionId: z.uuid(),
    }),
    z.strictObject({ type: z.literal('heartbeat'), requestId: z.uuid(), connectionId: z.uuid() }),
    z.strictObject({
      type: z.literal('error'),
      requestId: z.uuid().nullable(),
      code: z.enum([
        'DISABLED',
        'RUNTIME_OFFLINE',
        'VERSION_INCOMPATIBLE',
        'INVALID_MESSAGE',
        'SESSION_EXPIRED',
        'BRIDGE_BUSY',
      ]),
    }),
  ]),
]);
export const browserBridgeSnapshotSchema = z.strictObject({
  enabled: z.boolean(),
  connections: z
    .array(
      z.strictObject({
        installationId: z.uuid(),
        connectionId: z.uuid(),
        browser: z.enum(['chrome', 'edge']),
        extensionVersion: z.string().max(30),
        state: z.enum(['connected', 'disconnected', 'incompatible']),
        lastSeen: z.string().datetime(),
        toolsAvailable: z.boolean(),
      })
    )
    .max(16),
});
export type BridgeHello = z.infer<typeof bridgeHelloSchema>;
export type BrowserBridgeSnapshot = z.infer<typeof browserBridgeSnapshotSchema>;
export type HostMessage = z.infer<typeof hostMessageSchema>;
