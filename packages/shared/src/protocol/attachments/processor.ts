/**
 * @author Codex
 * @description Defines the versioned runtime protocol exchanged with isolated attachment processors.
 */

import { z } from 'zod';
import { ArtifactManifestV1Schema } from './document.js';

export const ProcessorLimitsV1Schema = z.object({
  wallTimeMs: z.number().int().positive().max(120_000),
  maxRssBytes: z
    .number()
    .int()
    .positive()
    .max(1024 * 1024 * 1024),
  maxOutputBytes: z
    .number()
    .int()
    .positive()
    .max(256 * 1024 * 1024),
  maxOutputFiles: z.number().int().positive().max(1_000),
  maxImagePixels: z.number().int().positive().max(40_000_000),
  maxPages: z.number().int().positive().max(500),
  maxExtractedCharacters: z.number().int().positive().max(2_000_000),
});

export const ProcessorStartV1Schema = z.object({
  protocol: z.literal(1),
  type: z.literal('start'),
  jobId: z.uuid(),
  attachmentId: z.uuid(),
  processor: z.object({ id: z.string().min(1), version: z.string().min(1) }),
  input: z.object({
    relativePath: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    detectedMediaType: z.string().min(1),
  }),
  outputDirectory: z.string().min(1),
  limits: ProcessorLimitsV1Schema,
});

export const ProcessorMessageV1Schema = z.discriminatedUnion('type', [
  z.object({
    protocol: z.literal(1),
    type: z.literal('heartbeat'),
    jobId: z.uuid(),
    rssBytes: z.number().int().nonnegative(),
  }),
  z.object({
    protocol: z.literal(1),
    type: z.literal('progress'),
    jobId: z.uuid(),
    completed: z.number().nonnegative(),
    total: z.number().nonnegative().optional(),
    phase: z.string().min(1).max(128),
  }),
  z.object({
    protocol: z.literal(1),
    type: z.literal('result'),
    jobId: z.uuid(),
    manifest: ArtifactManifestV1Schema,
  }),
  z.object({
    protocol: z.literal(1),
    type: z.literal('error'),
    jobId: z.uuid(),
    code: z.string().min(1).max(128),
    retryable: z.boolean(),
    message: z.string().min(1).max(512),
  }),
]);

export type ProcessorLimitsV1 = z.infer<typeof ProcessorLimitsV1Schema>;
export type ProcessorStartV1 = z.infer<typeof ProcessorStartV1Schema>;
export type ProcessorMessageV1 = z.infer<typeof ProcessorMessageV1Schema>;
