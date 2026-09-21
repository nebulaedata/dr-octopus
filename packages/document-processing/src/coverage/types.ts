/**
 * @author Codex
 * @description Defines parser-independent structure facts and actual extraction outcomes for coverage assessment.
 */
import type { CoverageFinding } from '@octopus/shared/protocol/attachments';
import type { PdfPageEvidence } from './pdf.js';
export interface PartFeature {
  code: CoverageFinding['code'];
  readableText?: boolean;
}
export type CoverageInput =
  | { format: 'pdf'; pages: PdfPageEvidence[]; pageCount: number; truncated: boolean }
  | {
      format: 'docx' | 'pptx' | 'xlsx';
      findings: CoverageFinding[];
      outcome: 'completed' | 'truncated' | 'failed';
      findingsOmitted: boolean;
    };
