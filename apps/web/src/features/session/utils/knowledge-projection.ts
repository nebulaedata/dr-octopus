/**
 * @author Codex
 * @description Reads bounded knowledge presentation data without interpreting model-facing text or changing retrieval order.
 */
import { isRecord, readString } from '@/features/session/utils/tool-renderer-utils';
import type { Translate } from '@/i18n/use-i18n';
import type { ToolProjection } from '@/stores/session';

export interface KnowledgeEvidence {
  title: string;
  text: string;
  citationId?: string;
  locator: string;
  ocr: boolean;
  truncated: boolean;
}

/**
 * Keep source metadata inert and constrain long titles, identifiers and excerpts before rendering.
 */
export function projectKnowledgeEvidence(
  t: Translate,
  value: unknown,
  citationId?: string
): KnowledgeEvidence | undefined {
  if (!isRecord(value) || typeof value.text !== 'string') {
    return undefined;
  }
  return {
    title:
      readString(value, 'title')?.slice(0, 240) ??
      t('session.knowledgeProjection.titleFallback', 'Source excerpt'),
    text: value.text.slice(0, 24000),
    citationId: (readString(value, 'citationId') ?? citationId)?.slice(0, 128),
    locator: formatKnowledgeLocator(t, value.locator),
    ocr: value.extractionMethod === 'ocr',
    truncated: value.text.length > 24000,
  };
}

/**
 * Format known locator fields only; never stringify objects supplied by source documents.
 */
export function formatKnowledgeLocator(t: Translate, value: unknown): string {
  if (!isRecord(value)) {
    return t('session.knowledgeProjection.fragmentFallback', 'Document fragment');
  }
  const labels: Record<string, string> = {
    page: t('session.knowledgeProjection.locator.page', 'Page'),
    slide: t('session.knowledgeProjection.locator.slide', 'Slide'),
    sheet: t('session.knowledgeProjection.locator.sheet', 'Sheet'),
    row: t('session.knowledgeProjection.locator.row', 'Row'),
    paragraph: t('session.knowledgeProjection.locator.paragraph', 'Paragraph'),
    archivePath: t('session.knowledgeProjection.locator.archivePath', 'Archive path'),
  };
  return (
    Object.entries(labels)
      .flatMap(([key, label]) => {
        const field = value[key];
        return typeof field === 'string' || (typeof field === 'number' && Number.isFinite(field))
          ? [`${label} ${String(field).slice(0, 160)}`]
          : [];
      })
      .join(' · ') || t('session.knowledgeProjection.fragmentFallback', 'Document fragment')
  );
}

/**
 * Summarize the same structured result in the shared collapsed shell, including pending and failed retrievals.
 */
export function summarizeKnowledgeTool(tool: ToolProjection, t: Translate): string | undefined {
  const query = readString(tool.arguments, 'query')?.slice(0, 160);
  if (tool.status === 'error') {
    return t('session.knowledgeProjection.errorSummary', 'Knowledge request incomplete · expand for details');
  }
  if (tool.name === 'knowledge_search') {
    return query
      ? t('session.knowledgeProjection.searchWithQuery', 'Search · {{query}}', { query })
      : t('session.knowledgeProjection.searchFallback', 'Find knowledge relevant to the question');
  }
  if (tool.name === 'knowledge_read') {
    return t('session.knowledgeProjection.readSummary', 'Read the source excerpt and its location');
  }
  return t('session.knowledgeProjection.collectionsSummary', 'Browse accessible knowledge collections');
}
