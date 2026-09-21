/**
 * @author Codex
 * @description Collects bounded Office facts during existing XML reads and distinguishes consumed parts from skipped content.
 */
import { classifyOfficePart } from '../office-part-policy.js';
import { classifyPart as docxPart } from './docx.js';
import { classifyPart as pptxPart } from './pptx.js';
import { classifyPart as xlsxPart } from './xlsx.js';
import { assessDocumentCoverage } from './index.js';
import type { CoverageFinding, DocumentCoverageV1 } from '@octopus/shared/protocol/attachments';
import type { PartFeature } from './types.js';

/**
 * Package inventory is structural evidence, not proof a resource is visible on a rendered page.
 */
function classifyResource(part: string): PartFeature | undefined {
  if (classifyOfficePart(part) === 'embedded') {
    return { code: 'EMBEDDED_CONTENT' };
  }
  if (/\/media\//u.test(part)) {
    return {
      code: /\.(png|jpe?g|gif|bmp|tiff?|svg|emf|wmf|webp)$/iu.test(part) ? 'IMAGE_CONTENT' : 'MEDIA_CONTENT',
    };
  }
  if (/\/charts\/[^/]+\.xml$/u.test(part)) {
    return { code: 'CHART_CONTENT' };
  }
  if (/\/diagrams\/[^/]+\.xml$/u.test(part)) {
    return { code: 'DIAGRAM_CONTENT' };
  }
  return undefined;
}

export class OfficeCoverageCollector {
  private readonly completed = new Set<string>();
  private readonly started = new Set<string>();
  private readonly findings = new Map<string, CoverageFinding>();
  private omitted = false;
  private locationCharacters = 0;
  /**
   * Uses the already validated ZIP directory; no additional file parsing or expansion occurs.
   */
  public constructor(
    private readonly format: 'docx' | 'pptx' | 'xlsx',
    private readonly parts: string[]
  ) {}
  /**
   * Observe each XML part once even when multiple extraction helpers read the same metadata.
   */
  public beginPart(part: string): boolean {
    if (this.started.has(part)) {
      return false;
    }
    this.started.add(part);
    return true;
  }
  /**
   * Records that all XML events in a part were consumed, rather than merely opened.
   */
  public finishPart(part: string): void {
    this.completed.add(part);
  }
  /**
   * Accepts namespace-qualified facts from the parser without retaining document text.
   */
  public observe(part: string, local: string, uri: string, attrs: Record<string, string>): void {
    const word = /wordprocessingml/u.test(uri);
    const sheet = /spreadsheetml/u.test(uri);
    if (word && ['del', 'ins', 'moveFrom', 'moveTo'].includes(local)) {
      this.add('REVISIONS', 'not-processed', part);
    }
    if (word && local === 'txbxContent') {
      this.add('LAYOUT', 'not-processed', part);
    }
    if (sheet && local === 'f') {
      this.add('FORMULA_VALUES', 'unknown', part);
    }
    if (sheet && local === 'sheet' && ['hidden', 'veryHidden'].includes(attrs.state ?? '')) {
      this.add('HIDDEN_SHEET', 'unknown', part, attrs.name);
    }
  }
  /**
   * Converts parser facts and actual termination into the common format-neutral result.
   */
  public report(outcome: 'completed' | 'truncated' | 'failed'): DocumentCoverageV1 {
    const rule = { docx: docxPart, pptx: pptxPart, xlsx: xlsxPart }[this.format];
    for (const part of this.parts) {
      const feature = classifyResource(part) ?? rule(part);
      if (!feature) {
        continue;
      }
      const status = feature.readableText
        ? this.completed.has(part)
          ? 'extracted'
          : outcome === 'truncated'
            ? 'truncated'
            : 'not-processed'
        : 'not-processed';
      this.add(feature.code, status, part);
    }
    const hidden = this.findings.get('HIDDEN_SHEET:unknown');
    if (hidden && outcome === 'completed') {
      hidden.status = 'extracted';
    }
    // Text extraction does not preserve visual layout, even when all textual regions were visited.
    if (this.format === 'pptx') {
      this.add('LAYOUT', 'not-processed', 'ppt/presentation.xml');
    }
    return assessDocumentCoverage({
      format: this.format,
      findings: [...this.findings.values()],
      outcome,
      findingsOmitted: this.omitted,
    });
  }
  /**
   * Aggregate occurrences while bounding locators and explicitly recording omission.
   */
  private add(
    code: CoverageFinding['code'],
    status: CoverageFinding['status'],
    part: string,
    sheet?: string
  ): void {
    const key = `${code}:${status}`;
    let finding = this.findings.get(key);
    if (!finding) {
      if (this.findings.size >= 100) {
        this.omitted = true;
        return;
      }
      finding = {
        code,
        status,
        evidence: 'structural',
        count: 0,
        countUnit: ['REVISIONS', 'LAYOUT', 'FORMULA_VALUES', 'HIDDEN_SHEET'].includes(code)
          ? 'occurrences'
          : 'parts',
        locations: [],
        locationsOmitted: false,
      };
      this.findings.set(key, finding);
    }
    finding.count++;
    if (!finding.locations.some((location) => location.part === part && location.sheet === sheet)) {
      if (
        finding.locations.length < 100 &&
        this.locationCharacters + part.length + (sheet?.length ?? 0) <= 32_000
      ) {
        this.locationCharacters += part.length + (sheet?.length ?? 0);
        if (part.length > 1024 || (sheet?.length ?? 0) > 255) {
          finding.locationsOmitted = true;
          this.omitted = true;
        }
        finding.locations.push({
          part: part.slice(0, 1024),
          ...(sheet ? { sheet: sheet.slice(0, 255) } : {}),
        });
      } else {
        finding.locationsOmitted = true;
        this.omitted = true;
      }
    }
  }
}
