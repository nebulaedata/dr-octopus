/**
 * @author Codex
 * @description Verifies attachment copy distinguishes scan suspicion and unknown content coverage.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { documentCoverageLabel } from '../src/features/session/document-coverage-label.ts';

/**
 * Returns the source default with interpolation so assertions pin the English contract.
 * Plural-aware keys always render the English `_other` form under this stub.
 */
const t = (key, defaultValue, options) =>
  defaultValue.replace(/\{\{(\w+)\}\}/g, (_, name) => String(options?.[name] ?? ''));

test('Unified PDF findings display scan and image content without format-specific conversion', () => {
  const coverage = {
    version: 1,
    format: 'pdf',
    assessmentStatus: 'assessed',
    textCoverage: 'partial',
    processing: { text: 'extracted' },
    findingsOmitted: false,
    limits: [],
    findings: [
      {
        code: 'SCAN_LIKELY',
        status: 'not-processed',
        evidence: 'heuristic',
        count: 98,
        countUnit: 'pages',
        locations: [{ page: 1 }],
        locationsOmitted: false,
      },
    ],
  };
  assert.match(documentCoverageLabel(t, coverage), /^Text extraction did not cover everything/u);
  assert.match(
    documentCoverageLabel(t, coverage),
    /Suspected scanned content \(98 pages, heuristic guess\): Not yet covered by text extraction/u
  );
  assert.match(documentCoverageLabel(t, coverage), /Locations: Pages 1/u);
  assert.doesNotMatch(documentCoverageLabel(t, coverage), /1–98/u);
  assert.equal(documentCoverageLabel(t), undefined);
  assert.match(
    documentCoverageLabel(t, {
      ...coverage,
      findings: [{ ...coverage.findings[0], code: 'IMAGE_CONTENT' }],
    }),
    /Images/u
  );
  assert.match(
    documentCoverageLabel(t, { ...coverage, findings: [], textCoverage: 'unknown' }),
    /^Document coverage is unknown/u
  );
});

test('Office labels distinguish extracted regions from unprocessed images and formula uncertainty', () => {
  const coverage = {
    version: 1,
    format: 'xlsx',
    assessmentStatus: 'assessed',
    textCoverage: 'partial',
    processing: { text: 'extracted' },
    findings: [
      {
        code: 'TEXT_REGION',
        status: 'extracted',
        evidence: 'structural',
        count: 1,
        countUnit: 'parts',
        locations: [],
        locationsOmitted: false,
      },
      {
        code: 'FORMULA_VALUES',
        status: 'unknown',
        evidence: 'structural',
        count: 1,
        countUnit: 'occurrences',
        locations: [],
        locationsOmitted: false,
      },
    ],
    findingsOmitted: false,
    limits: [],
  };
  const label = documentCoverageLabel(t, coverage);
  // The stub renders the English `_other` plural form even for count=1.
  assert.match(
    label,
    /Formula values \(1 occurrences, structural evidence\): Coverage or result reliability could not be verified/u
  );
  assert.match(
    label,
    /Text regions \(1 package parts, structural evidence\): Included in text extraction/u
  );
  assert.doesNotMatch(
    label,
    /Text regions \(1 package parts, structural evidence\): Only partially/u
  );
  assert.match(
    documentCoverageLabel(t, {
      ...coverage,
      processing: { ...coverage.processing, text: 'truncated' },
    }),
    /Text extraction was truncated/u
  );
});

test('Coverage descriptions preserve assessment, truncation, units and omitted details together', () => {
  const coverage = {
    version: 1,
    format: 'pptx',
    assessmentStatus: 'partial',
    textCoverage: 'partial',
    processing: { text: 'truncated' },
    findingsOmitted: true,
    limits: ['text', 'units', 'diagnostics'],
    findings: [
      {
        code: 'CHART_CONTENT',
        status: 'not-processed',
        evidence: 'structural',
        count: 12,
        countUnit: 'parts',
        locations: [{ part: 'ppt/charts/chart12.xml' }],
        locationsOmitted: true,
      },
    ],
  };
  const label = documentCoverageLabel(t, coverage);
  assert.match(label, /^Text extraction did not cover everything/u);
  assert.match(label, /Content feature checks are still incomplete/u);
  assert.match(label, /Text extraction was truncated/u);
  assert.match(label, /12 package parts/u);
  assert.match(label, /Part ppt\/charts\/chart12\.xml/u);
  assert.doesNotMatch(label, /Slide 12/u);
  assert.match(label, /Some locations were omitted/u);
  assert.match(label, /content unit count limit reached/u);
  assert.match(label, /the current list is not complete/u);
  assert.doesNotMatch(label, /OCR/iu);
});
