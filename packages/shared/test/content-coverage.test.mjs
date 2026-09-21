/**
 * @author Codex
 * @description Verifies the unified content coverage contract and its bounded findings.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentCoverageV1Schema } from '../dist/protocol/attachments/index.js';

test('Coverage validates unified content markers and bounds diagnostic locations', () => {
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
        count: 1,
        countUnit: 'pages',
        locations: [{ page: 1 }],
        locationsOmitted: false,
      },
    ],
  };
  assert.deepEqual(DocumentCoverageV1Schema.parse(coverage), coverage);
  assert.doesNotMatch(JSON.stringify(coverage), /ocr|visual/iu);
  assert.equal(
    DocumentCoverageV1Schema.safeParse({
      ...coverage,
      findings: [
        {
          ...coverage.findings[0],
          locations: Array.from({ length: 101 }, (_, index) => ({ page: index + 1 })),
        },
      ],
    }).success,
    false
  );
});
