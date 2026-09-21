/**
 * @author Codex
 * @description Defines bounded, format-neutral content coverage findings for document extraction.
 */
import { z } from 'zod';

export const CoverageLocatorSchema = z.object({
  page: z.number().int().positive().optional(),
  slide: z.number().int().positive().optional(),
  sheet: z.string().max(255).optional(),
  part: z.string().max(1024).optional(),
  region: z.string().max(80).optional(),
});
export const CoverageFindingSchema = z.object({
  code: z.enum([
    'SCAN_LIKELY',
    'IMAGE_CONTENT',
    'CHART_CONTENT',
    'DIAGRAM_CONTENT',
    'EMBEDDED_CONTENT',
    'MEDIA_CONTENT',
    'TEXT_REGION',
    'FORMULA_VALUES',
    'HIDDEN_SHEET',
    'REVISIONS',
    'LAYOUT',
    'UNKNOWN_COVERAGE',
  ]),
  status: z.enum(['extracted', 'not-processed', 'unsupported', 'failed', 'truncated', 'unknown']),
  evidence: z.enum(['structural', 'heuristic']),
  count: z.number().int().nonnegative(),
  countUnit: z.enum(['pages', 'parts', 'occurrences']),
  locations: z.array(CoverageLocatorSchema).max(100),
  locationsOmitted: z.boolean(),
});
export const DocumentCoverageV1Schema = z.object({
  version: z.literal(1),
  format: z.enum(['pdf', 'docx', 'pptx', 'xlsx']),
  assessmentStatus: z.enum(['assessed', 'partial', 'unknown']),
  textCoverage: z.enum(['text-layer-only', 'partial', 'unknown']),
  processing: z.object({
    text: z.enum(['extracted', 'failed', 'truncated', 'unknown']),
  }),
  findings: z.array(CoverageFindingSchema).max(100),
  findingsOmitted: z.boolean(),
  limits: z.array(z.enum(['text', 'units', 'diagnostics'])).max(3),
});
export type DocumentCoverageV1 = z.infer<typeof DocumentCoverageV1Schema>;
export type CoverageFinding = z.infer<typeof CoverageFindingSchema>;
export type CoverageLocator = z.infer<typeof CoverageLocatorSchema>;
