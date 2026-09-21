/**
 * @author Codex
 * @description Assesses bounded content coverage through one pure entry point for PDF and Office evidence.
 */
import { assessPdfCoverage } from './pdf.js';
import type { DocumentCoverageV1 } from '@octopus/shared/protocol/attachments';
import type { CoverageInput } from './types.js';
export type { CoverageInput } from './types.js';
export type { PdfPageEvidence } from './pdf.js';

/**
 * Reports known gaps and uncertainty without equating extracted strings with complete visual content.
 */
export function assessDocumentCoverage(input: CoverageInput): DocumentCoverageV1 {
  if (input.format === 'pdf') {
    const result = assessPdfCoverage(input.pages, input.pageCount);
    if (input.truncated) {
      result.processing.text = 'truncated';
      result.assessmentStatus = 'partial';
      result.textCoverage = 'partial';
      result.limits.push('text');
    }
    return result;
  }
  const incomplete = input.outcome !== 'completed';
  const missing = input.findings.some((finding) => finding.status !== 'extracted');
  return {
    version: 1,
    format: input.format,
    assessmentStatus: incomplete || input.findingsOmitted ? 'partial' : 'assessed',
    textCoverage: incomplete || missing ? 'partial' : 'text-layer-only',
    processing: {
      text: input.outcome === 'completed' ? 'extracted' : input.outcome,
    },
    findings: input.findings,
    findingsOmitted: input.findingsOmitted,
    limits: [
      ...(input.outcome === 'truncated' ? ['text' as const] : []),
      ...(input.findingsOmitted ? ['diagnostics' as const] : []),
    ],
  };
}
