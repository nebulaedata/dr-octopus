/**
 * @author Codex
 * @description Extracts the plain-text fallback and structured references from a Lexical document.
 */

import { $getRoot } from 'lexical';
import { $isFileMentionNode } from './workspace-mentions-plugin/file-mention-node';
import type { ComposerDraft } from '../types';

/**
 * Builds the transport-compatible text and future structured-reference payload in one editor read transaction.
 */
export function $buildComposerDraft(): ComposerDraft {
  const root = $getRoot();
  return {
    text: root.getTextContent(),
    references: root
      .getAllTextNodes()
      .filter($isFileMentionNode)
      .map((node) => node.getReference()),
  };
}
