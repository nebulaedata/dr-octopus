/**
 * @author Codex
 * @description Pure helpers for deriving anchor labels in the conversation mini-map.
 */

import type { ContentBlock, MessageProjection } from '@/stores/session';

/**
 * Maximum character length kept for tooltip/full preview text.
 */
const TOOLTIP_MAX_LENGTH = 80;

/**
 * Maximum character length kept for the popover markdown preview.
 */
const POPOVER_MAX_LENGTH = 240;

/**
 * Extracts the first textual content from a message for use as an anchor label.
 *
 * @param content - Normalized content blocks.
 * @returns The first text/thinking block, or an empty string if none exists.
 */
function extractPreviewText(content: ContentBlock[]): string {
  for (const block of content) {
    if (block.type === 'text' || block.type === 'thinking') {
      return block.text;
    }
  }
  return '';
}

/**
 * Builds the full tooltip text for a question anchor.
 *
 * @param message - The user message projection.
 * @returns Full preview text, truncated only for tooltip length.
 */
export function makeTooltipLabel(message: MessageProjection): string {
  const text = extractPreviewText(message.content).trim();
  if (text !== '') {
    return text.length > TOOLTIP_MAX_LENGTH ? `${text.slice(0, TOOLTIP_MAX_LENGTH)}…` : text;
  }
  const file = message.content.find(
    (block): block is Extract<ContentBlock, { type: 'file' }> => block.type === 'file'
  );
  if (file !== undefined) {
    return `File: ${file.name}`;
  }
  if (message.content.some((block) => block.type === 'image')) {
    return 'Image attachment';
  }
  return 'Message';
}

/**
 * Builds the markdown preview string rendered inside the question anchor popover.
 *
 * @param message - The user message projection.
 * @returns A markdown string suitable for MarkdownRenderer, truncated when too long.
 */
export function makePopoverMarkdown(message: MessageProjection): string {
  const text = extractPreviewText(message.content).trim();
  if (text !== '') {
    return text.length > POPOVER_MAX_LENGTH ? `${text.slice(0, POPOVER_MAX_LENGTH)}…` : text;
  }
  const file = message.content.find(
    (block): block is Extract<ContentBlock, { type: 'file' }> => block.type === 'file'
  );
  if (file !== undefined) {
    return `**File:** ${file.name}`;
  }
  if (message.content.some((block) => block.type === 'image')) {
    return '*Image attachment*';
  }
  return '*Message*';
}
