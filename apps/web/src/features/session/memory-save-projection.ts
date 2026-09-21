/**
 * @author Codex
 * @description Recognizes committed memory receipts without inferring saves from assistant replies.
 */

import type { MessageProjection } from '@/stores/session';

export interface MemorySaveProjection {
  count: number;
}

/**
 * Reads the existing text-only receipt contract shared by live and persisted custom messages.
 * Unknown formats retain the ordinary message renderer until their contract is supported.
 *
 * @returns The committed operation count, or undefined when the message is not a recognized receipt.
 */
export function projectMemorySave(message: MessageProjection): MemorySaveProjection | undefined {
  if (
    message.role !== 'custom' ||
    message.customType !== 'octopus-memory-operation' ||
    message.errorMessage !== undefined ||
    message.interrupted === true ||
    message.stopReason === 'error' ||
    (message.attachments?.length ?? 0) > 0 ||
    message.content.length !== 1
  ) {
    return undefined;
  }
  const block = message.content[0];
  const match = block?.type === 'text' ? /^已保存 ([1-9]\d*) 条长期记忆。$/u.exec(block.text) : null;
  if (match === null) {
    return undefined;
  }
  const count = Number(match[1]);
  return Number.isSafeInteger(count) ? { count } : undefined;
}
