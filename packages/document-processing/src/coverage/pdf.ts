/**
 * @author Codex
 * @description Classifies PDF text-layer coverage from bounded per-page evidence without selecting recognition tools.
 */
import type { DocumentCoverageV1, CoverageFinding } from '@octopus/shared/protocol/attachments';

export interface PdfPageEvidence {
  page: number;
  text: string;
  hasLargeImage: boolean | null;
}

/**
 * Combines sparse text, repeated short text, replacement glyphs, and substantial image resources.
 * Text-layer-only describes extraction method, never a guarantee of complete visual-page coverage.
 */
export function assessPdfCoverage(evidence: PdfPageEvidence[], pageCount: number): DocumentCoverageV1 {
  const repetitions = new Map<string, number>();
  for (const page of evidence) {
    const text = page.text.replace(/\s/gu, '');
    if (text.length > 0 && text.length <= 120) {
      repetitions.set(text, (repetitions.get(text) ?? 0) + 1);
    }
  }
  const pages: Array<{ page: number; kind: 'text' | 'scan-likely' | 'mixed' | 'unknown' }> = evidence.map(
    (page) => {
      const text = page.text.replace(/\s/gu, '');
      const repeatedShortText = (repetitions.get(text) ?? 0) >= 3;
      const sparse = text.length < 80 || repeatedShortText;
      const garbled = (text.match(/\uFFFD/gu)?.length ?? 0) > text.length / 10;
      const kind =
        page.hasLargeImage === null || garbled
          ? 'unknown'
          : page.hasLargeImage
            ? sparse
              ? 'scan-likely'
              : 'mixed'
            : text.length > 0
              ? 'text'
              : 'unknown';
      return {
        page: page.page,
        kind,
        textCharacters: text.length,
        hasLargeImage: page.hasLargeImage === true,
        repeatedShortText,
      };
    }
  );
  const completeAssessment = pages.length === pageCount;
  const scan = pages.some((page) => page.kind === 'scan-likely' || page.kind === 'mixed');
  const unknown = !completeAssessment || pages.some((page) => page.kind === 'unknown');
  const findings: CoverageFinding[] = [];
  for (const kind of ['scan-likely', 'mixed', 'unknown'] as const) {
    const matching = pages.filter((page) => page.kind === kind);
    if (matching.length === 0) {
      continue;
    }
    findings.push({
      code: kind === 'scan-likely' ? 'SCAN_LIKELY' : kind === 'mixed' ? 'IMAGE_CONTENT' : 'UNKNOWN_COVERAGE',
      status: kind === 'unknown' ? 'unknown' : 'not-processed',
      evidence: 'heuristic',
      count: matching.length,
      countUnit: 'pages',
      locations: matching.slice(0, 100).map((page) => ({ page: page.page })),
      locationsOmitted: matching.length > 100,
    });
  }
  return {
    version: 1,
    format: 'pdf',
    assessmentStatus: completeAssessment ? 'assessed' : 'partial',
    textCoverage: scan ? 'partial' : unknown ? 'unknown' : 'text-layer-only',
    processing: { text: 'extracted' },
    findings,
    findingsOmitted: false,
    limits: findings.some((finding) => finding.locationsOmitted) ? ['diagnostics'] : [],
  };
}
