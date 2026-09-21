/**
 * @author Codex
 * @description Projects Pi user messages into the Host-visible text and attachment presentation contract.
 */

import { isRecord } from '../../utils/index.js';

const HOST_CONTEXT_REQUEST_MARKER =
  /\r?\n<host_(attachment|workspace_reference)_request id="[^"\r\n]{1,1024}" \/>[\s\S]*$/u;

interface ProjectedHostText {
  text: string;
  hasHostContext: boolean;
  hasHostAttachmentContext: boolean;
}

/**
 * Removes Host-only context from a text block.
 *
 * @param text Text persisted by Pi after Host context adaptation.
 * @returns User-authored text and whether private Host context was present.
 */
function projectText(text: string): ProjectedHostText {
  const match = HOST_CONTEXT_REQUEST_MARKER.exec(text);
  if (match === null) {
    return { text, hasHostContext: false, hasHostAttachmentContext: false };
  }
  return {
    text: text.slice(0, match.index),
    hasHostContext: true,
    hasHostAttachmentContext: match[1] === 'attachment' || text.includes('\n<host_attachment_request id="'),
  };
}

/**
 * Produces the authoritative user-message shape exposed to Web clients.
 *
 * Pi persists model-facing Host context so crash recovery remains deterministic. This projection
 * hides that private suffix and suppresses Pi image/file blocks when Host attachment cards own them.
 *
 * @param message Arbitrary Pi message value.
 * @param hasAuthoritativeAttachments Whether Host message bindings own attachment presentation.
 * @returns The original value for non-user messages, otherwise a safe Host-visible projection.
 */
export function projectHostVisibleUserMessage(
  message: unknown,
  hasAuthoritativeAttachments = false
): unknown {
  if (!isRecord(message) || message['role'] !== 'user') {
    return message;
  }
  const content = message['content'];
  if (typeof content === 'string') {
    const projected = projectText(content);
    return projected.hasHostContext ? { ...message, content: projected.text } : message;
  }
  if (!Array.isArray(content)) {
    return message;
  }

  const blocks: unknown[] = content;
  let hasHostAttachmentContext = false;
  const projectedBlocks = blocks.map((block) => {
    if (!isRecord(block) || block['type'] !== 'text' || typeof block['text'] !== 'string') {
      return block;
    }
    const projected = projectText(block['text']);
    hasHostAttachmentContext ||= projected.hasHostAttachmentContext;
    return projected.hasHostContext ? { ...block, text: projected.text } : block;
  });
  const hasHostContext = projectedBlocks.some((block, index) => block !== blocks[index]);
  if (!hasHostContext && !hasAuthoritativeAttachments) {
    return message;
  }
  const ownsAttachmentPresentation = hasHostAttachmentContext || hasAuthoritativeAttachments;
  const visibleBlocks = ownsAttachmentPresentation
    ? projectedBlocks.filter(
        (block) => !isRecord(block) || (block['type'] !== 'image' && block['type'] !== 'file')
      )
    : projectedBlocks;
  return { ...message, content: visibleBlocks };
}
