/**
 * @author Codex
 * @description Maps Composer Enter gestures onto semantic draft submissions.
 */

import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { COMMAND_PRIORITY_LOW, KEY_ENTER_COMMAND } from 'lexical';
import { $buildComposerDraft } from '@/components/AgentComposerEditor/plugins/composer-draft';
import type { ComposerDraft } from '@/components/AgentComposerEditor/types';

export interface SubmitShortcutPluginProps {
  menuOpen: boolean;
  /**
   * Decides whether an Enter gesture means "submit"; supplied by the feature layer so user bindings apply.
   */
  isSubmitEvent(event: KeyboardEvent): boolean;
  /**
   * Submits the current structured draft.
   */
  onSubmit(draft: ComposerDraft, alternate: boolean): void;
}

/**
 * Submits on the configured send gesture, preserves every other Enter combo as a newline, and yields to an open typeahead menu.
 */
export function SubmitShortcutPlugin({ menuOpen, isSubmitEvent, onSubmit }: SubmitShortcutPluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(
    () =>
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          if (event === null || menuOpen || !isSubmitEvent(event)) {
            return false;
          }
          event.preventDefault();
          const draft = editor.getEditorState().read($buildComposerDraft);
          if (draft.text.trim() === '') {
            return true;
          }
          onSubmit(draft, event.altKey);
          return true;
        },
        COMMAND_PRIORITY_LOW
      ),
    [editor, menuOpen, isSubmitEvent, onSubmit]
  );

  return null;
}
