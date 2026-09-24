/**
 * @author Codex
 * @description Formats coverage conclusions, content findings and extraction limits without hiding partial coverage.
 */
import { coverageLocationsLabel } from '@/features/session/utils/document-coverage-locations';
import type { Translate } from '@/i18n/use-i18n';
import type { CoverageFinding, DocumentCoverageV1 } from '@octopus/shared/protocol/attachments';

/**
 * Maps one reported content category to its localized label.
 */
function contentLabel(t: Translate, code: CoverageFinding['code']): string {
  switch (code) {
    case 'SCAN_LIKELY':
      return t('session.coverage.content.scanLikely', 'Suspected scanned content');
    case 'IMAGE_CONTENT':
      return t('session.coverage.content.image', 'Images');
    case 'CHART_CONTENT':
      return t('session.coverage.content.chart', 'Charts');
    case 'DIAGRAM_CONTENT':
      return t('session.coverage.content.diagram', 'Diagrams');
    case 'EMBEDDED_CONTENT':
      return t('session.coverage.content.embedded', 'Embedded objects');
    case 'MEDIA_CONTENT':
      return t('session.coverage.content.media', 'Media');
    case 'TEXT_REGION':
      return t('session.coverage.content.textRegion', 'Text regions');
    case 'FORMULA_VALUES':
      return t('session.coverage.content.formulaValues', 'Formula values');
    case 'HIDDEN_SHEET':
      return t('session.coverage.content.hiddenSheet', 'Hidden sheets');
    case 'REVISIONS':
      return t('session.coverage.content.revisions', 'Revision data');
    case 'LAYOUT':
      return t('session.coverage.content.layout', 'Visual layout');
    case 'UNKNOWN_COVERAGE':
      return t('session.coverage.content.unknown', 'Unknown content');
    default:
      return code;
  }
}

/**
 * Maps one finding extraction status to its localized label.
 */
function findingStatusLabel(t: Translate, status: CoverageFinding['status']): string {
  switch (status) {
    case 'extracted':
      return t('session.coverage.findingStatus.extracted', 'Included in text extraction');
    case 'not-processed':
      return t('session.coverage.findingStatus.notProcessed', 'Not yet covered by text extraction');
    case 'unsupported':
      return t('session.coverage.findingStatus.unsupported', 'Not supported by current text extraction');
    case 'failed':
      return t('session.coverage.findingStatus.failed', 'Extraction failed for this content');
    case 'truncated':
      return t(
        'session.coverage.findingStatus.truncated',
        'Only partially included in text extraction; truncated'
      );
    case 'unknown':
      return t(
        'session.coverage.findingStatus.unknown',
        'Coverage or result reliability could not be verified'
      );
    default:
      return status;
  }
}

/**
 * Formats one finding count with its localized plural unit.
 */
function countWithUnit(t: Translate, finding: CoverageFinding): string {
  switch (finding.countUnit) {
    case 'pages':
      return t('session.coverage.unit.pages', '{{count}} pages', { count: finding.count });
    case 'parts':
      return t('session.coverage.unit.parts', '{{count}} package parts', { count: finding.count });
    case 'occurrences':
      return t('session.coverage.unit.occurrences', '{{count}} occurrences', { count: finding.count });
    default:
      return String(finding.count);
  }
}

/**
 * Always leads with coverage rather than allowing one content category to mask limitations.
 */
export function documentCoverageLabel(t: Translate, coverage?: DocumentCoverageV1): string | undefined {
  if (!coverage) {
    return undefined;
  }
  const conclusions: Record<DocumentCoverageV1['textCoverage'], string> = {
    partial: t(
      'session.coverage.conclusion.partial',
      'Text extraction did not cover everything; the current text cannot represent the full document.'
    ),
    unknown: t(
      'session.coverage.conclusion.unknown',
      'Document coverage is unknown; cannot confirm which content the current text covers.'
    ),
    'text-layer-only': t(
      'session.coverage.conclusion.textLayerOnly',
      'Only the text layer was extracted; this does not represent the full visual content.'
    ),
  };
  const sections = [conclusions[coverage.textCoverage]];
  if (coverage.assessmentStatus === 'partial') {
    sections.push(
      t(
        'session.coverage.assessment.partial',
        'Content feature checks are still incomplete; the entries below may not cover everything.'
      )
    );
  } else if (coverage.assessmentStatus === 'unknown') {
    sections.push(t('session.coverage.assessment.unknown', 'Content feature check results are unknown.'));
  }
  const textStates: Record<DocumentCoverageV1['processing']['text'], string> = {
    extracted: t('session.coverage.extraction.extracted', 'Text extraction completed for this pass'),
    failed: t('session.coverage.extraction.failed', 'Text extraction failed'),
    truncated: t('session.coverage.extraction.truncated', 'Text extraction was truncated'),
    unknown: t('session.coverage.extraction.unknown', 'Text extraction status is unknown'),
  };
  sections.push(
    t('session.coverage.extractionStatusLine', '[Extraction status]:\n{{status}}.', {
      status: textStates[coverage.processing.text],
    })
  );
  if (coverage.findings.length) {
    sections.push(
      t('session.coverage.findingsLine', '[Content findings and coverage]:\n{{findings}}', {
        findings: coverage.findings.map((finding) => findingLabel(t, finding)).join('\n\n'),
      })
    );
  } else {
    sections.push(
      t('session.coverage.noFindings', 'No specific content findings or locator entries were provided.')
    );
  }
  const limits: Record<DocumentCoverageV1['limits'][number], string> = {
    text: t('session.coverage.limit.text', 'text extraction limit reached'),
    units: t('session.coverage.limit.units', 'content unit count limit reached'),
    diagnostics: t(
      'session.coverage.limit.diagnostics',
      'coverage record limit reached; some details not listed'
    ),
  };
  if (coverage.limits.length) {
    sections.push(
      t('session.coverage.limitsLine', 'Extraction limits: {{limits}}.', {
        limits: coverage.limits
          .map((limit) => limits[limit])
          .join(t('session.coverage.limitsSeparator', '; ')),
      })
    );
  }
  if (coverage.findingsOmitted) {
    sections.push(
      t(
        'session.coverage.detailsOmitted',
        'Some coverage details were omitted; the current list is not complete.'
      )
    );
  }
  return sections.join('\n\n');
}

/**
 * Keeps counts, evidence strength and extraction status independent for each reported content feature.
 */
function findingLabel(t: Translate, finding: CoverageFinding): string {
  const evidence =
    finding.evidence === 'heuristic'
      ? t('session.coverage.evidence.heuristic', 'heuristic guess')
      : t('session.coverage.evidence.structural', 'structural evidence');
  const lines = [
    t('session.coverage.findingLine', '{{label}} ({{countWithUnit}}, {{evidence}}): {{status}}.', {
      label: contentLabel(t, finding.code),
      countWithUnit: countWithUnit(t, finding),
      evidence,
      status: findingStatusLabel(t, finding.status),
    }),
  ];
  lines.push(
    t('session.coverage.locationsLine', 'Locations: {{locations}}.', {
      locations: coverageLocationsLabel(t, finding.locations),
    })
  );
  if (finding.locationsOmitted) {
    lines.push(
      t(
        'session.coverage.locationsOmitted',
        'Some locations were omitted; the locations shown are not the complete list.'
      )
    );
  }
  return lines.join('\n');
}
