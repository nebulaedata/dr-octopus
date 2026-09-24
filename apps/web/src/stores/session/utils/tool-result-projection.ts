/**
 * @author Codex
 * @description Normalizes Pi tool results into a stable browser projection shared by live and persisted sessions.
 */

import type { ToolContentBlock } from '../type';

export interface NormalizedToolResult {
  content: ToolContentBlock[];
  details?: unknown;
  usage?: unknown;
  addedToolNames?: string[];
  terminate?: boolean;
}

/**
 * Normalizes a Pi AgentToolResult, a persisted ToolResultMessage, or a legacy raw value.
 *
 * @param value - Result payload received from a runtime event or persisted message.
 * @returns A stable result whose content is always safe to iterate.
 */
export function normalizeToolResult(value: unknown): NormalizedToolResult {
  if (typeof value === 'string') {
    return { content: [{ type: 'text', text: value }] };
  }
  if (Array.isArray(value)) {
    return { content: normalizeToolContent(value) };
  }
  if (!isRecord(value)) {
    return { content: [] };
  }
  if (!('content' in value)) {
    return { content: [], details: value };
  }
  const addedToolNames = Array.isArray(value['addedToolNames'])
    ? value['addedToolNames'].filter((name): name is string => typeof name === 'string')
    : undefined;
  return {
    content: normalizeToolContent(value['content']),
    ...('details' in value ? { details: value['details'] } : {}),
    ...('usage' in value ? { usage: value['usage'] } : {}),
    ...(addedToolNames === undefined ? {} : { addedToolNames }),
    ...(typeof value['terminate'] === 'boolean' ? { terminate: value['terminate'] } : {}),
  };
}

/**
 * Merges a live partial or final result over the last projected tool state.
 *
 * @param previous - Result fields already visible in the browser.
 * @param value - New Pi result payload, or undefined for a start event.
 * @returns Result fields with omitted updates preserved and explicit updates replaced.
 */
export function mergeToolResultProjection(
  previous: NormalizedToolResult | undefined,
  value: unknown
): NormalizedToolResult {
  const next = value === undefined ? undefined : normalizeToolResult(value);
  const merged: NormalizedToolResult = {
    content: next?.content ?? previous?.content ?? [],
  };
  if (previous !== undefined) {
    copyOptionalFields(merged, previous);
  }
  if (next !== undefined) {
    copyOptionalFields(merged, next);
  }
  return merged;
}

/**
 * Narrows Pi tool content to the text and image blocks supported by version 0.84.3.
 *
 * @param value - Unknown content collection.
 * @returns Valid browser tool content blocks in their original order.
 */
function normalizeToolContent(value: unknown): ToolContentBlock[] {
  if (typeof value === 'string') {
    return [{ type: 'text', text: value }];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((part): ToolContentBlock[] => {
    if (!isRecord(part)) {
      return [];
    }
    if (part['type'] === 'text') {
      return [{ type: 'text', text: String(part['text'] ?? '') }];
    }
    if (part['type'] === 'image') {
      return [
        {
          type: 'image',
          data: String(part['data'] ?? ''),
          mimeType: String(part['mimeType'] ?? ''),
        },
      ];
    }
    return [];
  });
}

/**
 * Copies explicitly present optional protocol fields without inventing absent values.
 *
 * @param target - Mutable normalized result being assembled.
 * @param source - Earlier or newer result fields.
 */
function copyOptionalFields(target: NormalizedToolResult, source: NormalizedToolResult): void {
  if ('details' in source) {
    target.details = source.details;
  }
  if ('usage' in source) {
    target.usage = source.usage;
  }
  if ('addedToolNames' in source) {
    target.addedToolNames = source.addedToolNames;
  }
  if ('terminate' in source) {
    target.terminate = source.terminate;
  }
}

/**
 * Checks whether an unknown value can expose named protocol fields.
 *
 * @param value - Candidate protocol value.
 * @returns Whether the value is a non-null object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
