/**
 * @author Codex
 * @description Projects bounded memory snapshots into readable entries without fetching newer facts.
 */

import { isRecord, readString } from '../tool-renderer-utils';
import type { Translate } from '@/i18n/use-i18n';
import type { ToolProjection } from '@/stores/session';

/**
 * Maps one memory document type to its localized label, falling back to a generic noun.
 */
function memoryTypeLabel(t: Translate, type: string): string {
  switch (type) {
    case 'preference':
      return t('session.memoryProjection.type.preference', 'Preference');
    case 'decision':
      return t('session.memoryProjection.type.decision', 'Decision');
    case 'architecture':
      return t('session.memoryProjection.type.architecture', 'Architecture');
    case 'constraint':
      return t('session.memoryProjection.type.constraint', 'Constraint');
    case 'workflow':
      return t('session.memoryProjection.type.workflow', 'Workflow');
    case 'environment':
      return t('session.memoryProjection.type.environment', 'Environment');
    case 'correction':
      return t('session.memoryProjection.type.correction', 'Correction');
    case 'instruction':
      return t('session.memoryProjection.type.instruction', 'Instruction');
    case 'other':
      return t('session.memoryProjection.type.other', 'Other');
    default:
      return t('session.memoryProjection.typeFallback', 'Memory');
  }
}

export interface MemoryEntryProjection {
  id: string;
  topic: string;
  type: string;
  summary: string;
  body?: string;
  sources: string[];
  revision?: number;
  unavailable: boolean;
  superseded: boolean;
  truncated: boolean;
}

export interface MemoryToolDetailsProjection {
  action: 'recall' | 'read';
  items: MemoryEntryProjection[];
  total: number;
  available: number;
  query?: string;
  notice?: string;
}

/**
 * Accepts only the known result envelope and readable entries; malformed output keeps the raw fallback.
 */
export function projectMemoryTool(t: Translate, tool: ToolProjection): MemoryToolDetailsProjection | undefined {
  const data = isRecord(tool.details) ? tool.details : undefined;
  if (
    tool.status === 'error' ||
    data?.version !== 1 ||
    !Array.isArray(data.items) ||
    typeof data.complete !== 'boolean' ||
    (data.action !== 'recall' && data.action !== 'read') ||
    (tool.name === 'memory_recall' && data.action !== 'recall') ||
    (tool.name === 'memory_read' && data.action !== 'read')
  ) {
    return undefined;
  }
  const items: MemoryEntryProjection[] = [];
  for (const value of data.items.slice(0, 20)) {
    const entry = projectEntry(t, value, data.action);
    if (entry === undefined) {
      return undefined;
    }
    items.push(entry);
  }
  return {
    action: data.action,
    items,
    total: data.items.length,
    available: items.filter((item) => !item.unavailable).length,
    query: data.action === 'recall' ? readString(tool.arguments, 'query')?.slice(0, 300) : undefined,
    notice: memoryCoverageNotice(t, data, tool),
  };
}

/**
 * Keeps individual missing references visible instead of counting them as successfully read facts.
 */
function projectEntry(
  t: Translate,
  value: unknown,
  action: 'recall' | 'read'
): MemoryEntryProjection | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const ref = action === 'read' ? value.ref : value;
  if (!isRecord(ref) || typeof ref.storeId !== 'string' || !positiveInteger(ref.indexId)) {
    return undefined;
  }
  const id = `${ref.storeId.slice(0, 100)}:${String(ref.indexId)}`;
  const document = action === 'read' ? value.document : value;
  if (document === undefined && typeof value.error === 'string') {
    return {
      id,
      topic: t('session.memoryProjection.unavailableTopic', 'Memory #{{id}}', { id: ref.indexId }),
      type: t('session.memoryProjection.unavailableType', 'Unavailable'),
      summary: t(
        'session.memoryProjection.unavailableSummary',
        'This memory was unavailable during this read; it may have been deleted or superseded.'
      ),
      sources: [],
      unavailable: true,
      superseded: false,
      truncated: false,
    };
  }
  if (
    !isRecord(document) ||
    typeof document.topic !== 'string' ||
    typeof document.indexText !== 'string' ||
    typeof document.type !== 'string' ||
    !positiveInteger(document.revision)
  ) {
    return undefined;
  }
  const sources: string[] = [];
  if (action === 'read') {
    if (typeof document.bodyMd !== 'string' || !Array.isArray(document.sources)) {
      return undefined;
    }
    for (const source of document.sources.slice(0, 20)) {
      if (!isRecord(source) || typeof source.evidence !== 'string') {
        return undefined;
      }
      sources.push(source.evidence.slice(0, 800));
    }
  }
  return {
    id,
    topic: document.topic.slice(0, 200) || t('session.memoryProjection.topicFallback', 'Long-term memory'),
    type: memoryTypeLabel(t, document.type),
    summary: document.indexText.slice(0, 240),
    ...(action === 'read' ? { body: (document.bodyMd as string).slice(0, 16000) } : {}),
    sources,
    revision: document.revision,
    unavailable: false,
    superseded: document.status === 'superseded',
    truncated:
      document.indexText.length > 240 ||
      document.topic.length > 200 ||
      (typeof document.bodyMd === 'string' && document.bodyMd.length > 16000) ||
      (Array.isArray(document.sources) &&
        (document.sources.length > 20 ||
          document.sources.some(
            (source) =>
              isRecord(source) && typeof source.evidence === 'string' && source.evidence.length > 800
          ))),
  };
}

/**
 * Distinguishes search candidates, unfinished pages and partial reads without claiming exhaustive history.
 */
function memoryCoverageNotice(
  t: Translate,
  data: Record<string, unknown>,
  tool: ToolProjection
): string | undefined {
  if (data.searchUnavailable === true) {
    return t(
      'session.memoryProjection.noticeSearchUnavailable',
      'Search is temporarily unavailable; these results do not represent all memories.'
    );
  }
  if (data.action === 'read') {
    return data.complete === false
      ? t('session.memoryProjection.noticePartialBody', 'Only part of the body was returned; later reads can complete it.')
      : undefined;
  }
  if (readString(tool.arguments, 'mode') === 'search') {
    return data.complete === false
      ? t('session.memoryProjection.noticePartialLeads', 'This search returned only some relevant leads.')
      : t(
          'session.memoryProjection.noticeSearchSubset',
          'Results reflect this keyword search and do not represent all memories.'
        );
  }
  return data.complete === false || data.exhausted !== true
    ? t('session.memoryProjection.noticeMorePages', 'The directory has more entries to review.')
    : undefined;
}

/**
 * Rejects unusable reference and revision values before displaying them as identifiers.
 */
function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/**
 * Makes collapsed memory tools useful while preserving pending, failed and partial-result semantics.
 */
export function summarizeMemoryTool(tool: ToolProjection, t: Translate): string {
  if (tool.status === 'error') {
    return t('session.memoryProjection.errorSummary', 'Request incomplete · expand for details');
  }
  if (tool.status === 'running') {
    return tool.name === 'memory_read'
      ? t('session.memoryProjection.runningRead', 'Reading memory body…')
      : t('session.memoryProjection.runningRecall', 'Searching memories…');
  }
  const result = projectMemoryTool(t, tool);
  if (result === undefined) {
    return t('session.memoryProjection.fallbackSummary', 'Expand to view memory results');
  }
  const partial = result.total > result.items.length;
  const summary =
    result.action === 'read'
      ? partial
        ? t('session.memoryProjection.summaryReadablePartial', 'Showing {{count}} memories readable', {
            count: result.available,
          })
        : t('session.memoryProjection.summaryReadable', '{{count}} memories readable', {
            count: result.available,
          })
      : partial
        ? t('session.memoryProjection.summaryLeadsPartial', 'Showing {{count}} memory leads', {
            count: result.available,
          })
        : t('session.memoryProjection.summaryLeads', '{{count}} memory leads', { count: result.available });
  const topic = result.items.find((item) => !item.unavailable)?.topic;
  return `${summary}${topic ? ` · ${topic}` : ''}`;
}
