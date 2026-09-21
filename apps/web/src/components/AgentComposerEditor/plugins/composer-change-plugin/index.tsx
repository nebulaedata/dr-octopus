/**
 * @author Codex
 * @description Emits structured Composer drafts on every Lexical editor change.
 */

import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { $buildComposerDraft } from '@/components/AgentComposerEditor/plugins/composer-draft';
import type { EditorState } from 'lexical';
import type { ComposerDraft } from '@/components/AgentComposerEditor/types';

export interface ComposerChangePluginProps {
  /**
   * Receives each structured editor-state change.
   */
  onChange(draft: ComposerDraft): void;
}

/**
 * Emits plain text and structured references from one consistent editor snapshot.
 */
export function ComposerChangePlugin({ onChange }: ComposerChangePluginProps) {
  /**
   * Reads the editor only within its immutable transaction boundary.
   */
  function handleChange(editorState: EditorState): void {
    onChange(editorState.read($buildComposerDraft));
  }

  return <OnChangePlugin ignoreSelectionChange onChange={handleChange} />;
}
