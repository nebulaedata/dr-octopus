/**
 * @author Codex
 * @description Provides safe serialization and field readers for tool result renderers.
 */

import type { Translate } from '@/i18n/use-i18n';
import type { ToolProjection } from '@/stores/session';

const MAX_SERIALIZED_CHARACTERS = 20_000;

/**
 * Safely serializes an unknown tool value and bounds its rendered size.
 *
 * @param value - Arbitrary tool arguments or structured details.
 * @returns Human-readable text suitable for a diagnostic code block.
 */
export function formatToolValue(value: unknown): string {
  let source: string;
  try {
    source = typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? String(value));
  } catch {
    source = String(value);
  }
  return source.length > MAX_SERIALIZED_CHARACTERS
    ? `${source.slice(0, MAX_SERIALIZED_CHARACTERS)}\n… output truncated`
    : source;
}

/**
 * Narrows an unknown payload before a specialized renderer reads named fields.
 *
 * @param value - Candidate arguments or details object.
 * @returns Whether named fields can be read safely.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Reads a non-empty string field from an unknown record.
 *
 * @param value - Candidate record.
 * @param key - Field to read.
 * @returns The string value when present and non-empty.
 */
export function readString(value: unknown, key: string): string | undefined {
  if (!isRecord(value) || typeof value[key] !== 'string' || value[key].length === 0) {
    return undefined;
  }
  return value[key];
}

/**
 * Uses the most useful path-like argument as the collapsed card summary.
 */
export function summarizePath(tool: ToolProjection): string | undefined {
  return readString(tool.arguments, 'path');
}

/**
 * Uses the shell command as the collapsed card summary.
 */
export function summarizeCommand(tool: ToolProjection): string | undefined {
  return readString(tool.arguments, 'command');
}

/**
 * Uses the search pattern and optional root as the collapsed card summary.
 */
export function summarizeSearch(tool: ToolProjection, t: Translate): string | undefined {
  const pattern = readString(tool.arguments, 'pattern');
  const path = readString(tool.arguments, 'path');
  if (pattern === undefined) {
    return path;
  } else if (path === undefined) {
    return pattern;
  } else {
    return t('session.toolCard.patternInPath', '{{pattern}} in {{path}}', { pattern, path });
  }
}
