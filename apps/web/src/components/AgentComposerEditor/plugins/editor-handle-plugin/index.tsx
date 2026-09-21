/**
 * @author Codex
 * @description Exposes focused text insertion without leaking the Lexical editor instance to Composer consumers.
 */

import { useImperativeHandle } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getRoot, $getSelection, $isRangeSelection } from 'lexical';
import { formatCommandInsertion } from '@/components/AgentComposerEditor/command-insertion';
import type { Ref } from 'react';
import type { AgentComposerEditorHandle, ComposerTrigger } from '@/components/AgentComposerEditor/types';

export interface EditorHandlePluginProps {
  handleRef?: Ref<AgentComposerEditorHandle>;
}

/**
 * Binds the public Composer handle to the active Lexical editor and its restored caret.
 */
export function EditorHandlePlugin({ handleRef }: EditorHandlePluginProps) {
  const [editor] = useLexicalComposerContext();

  useImperativeHandle(
    handleRef,
    () => ({
      /**
       * Restores the selection, falling back to the draft end when no selection exists.
       */
      focus(): void {
        if (editor.isEditable()) {
          editor.focus(undefined, { defaultSelection: 'rootEnd' });
        }
      },
      /**
       * Focuses the editor and inserts a trigger with the boundary required by Lexical typeahead matching.
       */
      insertTrigger(trigger: ComposerTrigger): void {
        editor.focus(() => {
          editor.update(() => {
            const selection = $getSelection();
            if ($isRangeSelection(selection)) {
              const prefix = $getRoot().getTextContent() === '' ? '' : ' ';
              selection.insertText(`${prefix}${trigger}`);
            }
          });
        });
      },
      /**
       * Focuses the editor and inserts a complete slash command with an argument-ready suffix.
       */
      insertCommand(commandName: string): void {
        editor.focus(() => {
          editor.update(() => {
            const selection = $getSelection();
            if ($isRangeSelection(selection)) {
              selection.insertText(formatCommandInsertion(commandName, $getRoot().getTextContent() !== ''));
            }
          });
        });
      },
    }),
    [editor]
  );

  return null;
}
