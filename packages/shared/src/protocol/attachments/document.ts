/**
 * @author Codex
 * @description Defines versioned attachment artifact and structured-document runtime contracts.
 */

import { z } from 'zod';
import { DocumentCoverageV1Schema } from './coverage.js';

export const ArtifactOutputV1Schema = z.object({
  localId: z.string().min(1),
  kind: z.enum(['model-image', 'preview-image', 'document-json', 'chunks-jsonl']),
  relativePath: z.string().min(1),
  mimeType: z.string().min(1),
  byteSize: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

export const ArtifactManifestV1Schema = z.object({
  schemaVersion: z.literal(1),
  attachmentId: z.uuid(),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  processor: z.object({ id: z.string().min(1), version: z.string().min(1) }),
  outputs: z.array(ArtifactOutputV1Schema).max(1_000),
  summary: z.object({
    coverage: DocumentCoverageV1Schema.optional(),
    pageCount: z.number().int().nonnegative().optional(),
    sheetCount: z.number().int().nonnegative().optional(),
    slideCount: z.number().int().nonnegative().optional(),
    sectionCount: z.number().int().nonnegative().optional(),
    extractedCharacters: z.number().int().nonnegative().optional(),
  }),
});

export const StructuredLocatorV1Schema = z.object({
  archivePath: z.string().max(4096).optional(),
  page: z.number().int().positive().optional(),
  sheet: z.string().max(255).optional(),
  slide: z.number().int().positive().optional(),
  section: z.string().max(255).optional(),
  lineFrom: z.number().int().positive().optional(),
  lineTo: z.number().int().positive().optional(),
});

export const StructuredDocumentV1Schema = z.object({
  schemaVersion: z.literal(1),
  kind: z.enum(['pdf', 'docx', 'xlsx', 'pptx', 'zip', 'text', 'source']),
  title: z.string().max(1_024).optional(),
  units: z.array(
    z.object({
      locator: StructuredLocatorV1Schema,
      type: z.enum(['heading', 'paragraph', 'table', 'code', 'note']),
      text: z.string(),
    })
  ),
  truncated: z.boolean(),
  diagnostics: z.array(z.string().max(256)),
  coverage: DocumentCoverageV1Schema.optional(),
});

export const NormalizedChunkV1Schema = z.object({
  schemaVersion: z.literal(1),
  ordinal: z.number().int().nonnegative(),
  locator: StructuredLocatorV1Schema,
  text: z.string().max(4_000),
  characterCount: z.number().int().nonnegative(),
  tokenEstimate: z.number().int().nonnegative(),
});

export type ArtifactManifestV1 = z.infer<typeof ArtifactManifestV1Schema>;
export type StructuredDocumentV1 = z.infer<typeof StructuredDocumentV1Schema>;
export type NormalizedChunkV1 = z.infer<typeof NormalizedChunkV1Schema>;
