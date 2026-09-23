/**
 * @author Codex
 * @description Versioned, bounded global memory contracts shared by Agent and browser adapters.
 */
import { z } from 'zod';

export const memoryModeSchema = z.enum(['off', 'manual', 'auto']);
export const memoryRefSchema = z
  .object({ storeId: z.string().min(1).max(100), indexId: z.number().int().positive().safe() })
  .strict();
export const memorySourceSchema = z
  .object({
    sessionId: z.string().min(1).max(200),
    entryId: z.string().min(1).max(200),
    evidence: z.string().max(800),
  })
  .strict();
export const memoryFactSchema = z.object({
  canonicalKey: z.string().trim().min(1).max(200),
  topic: z.string().trim().min(1).max(200),
  type: z.enum([
    'preference',
    'decision',
    'architecture',
    'constraint',
    'workflow',
    'environment',
    'correction',
    'instruction',
    'other',
  ]),
  indexText: z.string().trim().min(1).max(240),
  bodyMd: z.string().trim().min(1).max(16000),
  sources: z.array(memorySourceSchema).max(20).default([]),
});
export const memoryRememberSchema = memoryFactSchema
  .extend({
    requestId: z.string().min(1).max(200),
    target: memoryRefSchema.optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
    action: z.enum(['create', 'update', 'merge', 'supersede']).default('create'),
  })
  .strict();
export const memoryForgetSchema = z
  .object({
    requestId: z.string().min(1).max(200),
    ref: memoryRefSchema,
    expectedRevision: z.number().int().positive(),
  })
  .strict();
export const memoryPolicySchema = z
  .object({
    requestId: z.string().min(1).max(200),
    mode: memoryModeSchema,
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
export const memoryRecallSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('search'), query: z.string().trim().min(1).max(300) }).strict(),
  z.object({ mode: z.literal('page'), cursor: z.string().max(1500).optional() }).strict(),
]);
export const memoryReadSchema = z
  .object({ refs: z.array(memoryRefSchema).min(1).max(5), continuation: z.string().max(1500).optional() })
  .strict();
export type MemoryMode = z.infer<typeof memoryModeSchema>;
export type MemoryRef = z.infer<typeof memoryRefSchema>;
export type MemorySource = z.infer<typeof memorySourceSchema>;
export type MemoryFact = z.infer<typeof memoryFactSchema>;
export type MemoryRemember = z.infer<typeof memoryRememberSchema>;
export type MemoryForget = z.infer<typeof memoryForgetSchema>;
export type MemoryPolicy = z.infer<typeof memoryPolicySchema>;
export type MemoryRecall = z.infer<typeof memoryRecallSchema>;
export type MemoryRead = z.infer<typeof memoryReadSchema>;
export interface MemoryIndex extends MemoryRef {
  canonicalKey: string;
  topic: string;
  type: string;
  indexText: string;
  revision: number;
  activationSeq: number;
  updatedAt: number;
  status: 'active' | 'superseded';
}
export interface MemoryDocument extends MemoryIndex {
  bodyMd: string;
  sources: MemorySource[];
}
export interface MemoryStatus {
  version: 1;
  storeId?: string;
  mode: MemoryMode;
  revision: number;
  writeEpoch: number;
  availability: 'ready' | 'uninitialized' | 'unavailable' | 'read-only';
  count: number;
}
export interface MemoryPage {
  version: 1;
  action: 'recall';
  items: MemoryIndex[];
  revision: number;
  exhausted: boolean;
  nextCursor?: string;
  searchUnavailable?: boolean;
  complete: boolean;
  stopReason?: string;
}
export interface MemoryReadResult {
  version: 1;
  action: 'read';
  items: Array<{ ref: MemoryRef; document?: MemoryDocument; error?: string }>;
  complete: boolean;
  continuation?: string;
  stopReason?: string;
}
export interface MemoryReceipt {
  requestId: string;
  action: string;
  status: 'committed';
  revision: number;
  ref?: MemoryRef;
}
export const memoryRuntimeSchema = z.object({
  version: z.literal(1),
  storeId: z.string().max(100).optional(),
  mode: memoryModeSchema,
  availability: z.enum(['ready', 'uninitialized', 'unavailable', 'read-only']),
  revision: z.number().int().nonnegative(),
  curator: z.enum(['idle', 'running', 'committed', 'skipped', 'failed']),
  errorCode: z.string().max(100).optional(),
});
export type MemoryRuntimeSnapshot = z.infer<typeof memoryRuntimeSchema>;

export const memoryServiceCommandSchema = z
  .object({
    operation: z.string(),
    input: z.unknown().optional(),
    maxBytes: z.number().int().min(1).max(128000).optional(),
    epoch: z.number().int().nonnegative().optional(),
  })
  .strict();
export const memoryCurationBeginSchema = z
  .object({ sources: z.array(memorySourceSchema).max(100), explicit: z.boolean() })
  .strict();
export const memoryCurationNextSchema = z
  .object({ id: z.string().uuid(), proposals: z.array(memoryRememberSchema).max(5) })
  .strict();
export const memoryCurationIdSchema = z.string().uuid();
export const memoryRefsSchema = z.array(memoryRefSchema).max(1000);

export interface MemoryServiceStatus {
  schemaVersion: 1;
  state: 'absent' | 'stopped' | 'starting' | 'running' | 'stopping' | 'unavailable';
  health: 'ready' | 'degraded' | 'unavailable' | 'unknown';
  profileId?: string;
  daemonId?: string;
  pid?: number;
  autostartSuppressed: boolean;
  uptimeMs?: number;
  controlRevision?: number;
  checks?: { name: string; status: 'pass' | 'warn' | 'fail'; reason?: string }[];
}

/**
 * Automatic screening is a memory policy; Jev owns only connection configuration.
 */
export const memoryScreeningSettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    timeoutMs: z.number().int().min(250).max(5000).default(1500),
    skipThreshold: z.number().min(0.95).max(1).default(0.95),
  })
  .strict();
export const memoryScreeningUpdateSchema = memoryScreeningSettingsSchema
  .extend({
    revision: z.string().min(1).max(100),
  })
  .strict();
export type MemoryScreeningSettings = z.infer<typeof memoryScreeningSettingsSchema>;
export type MemoryScreeningSnapshot = MemoryScreeningSettings & { revision: string };
export type MemoryScreeningUpdate = z.infer<typeof memoryScreeningUpdateSchema>;
