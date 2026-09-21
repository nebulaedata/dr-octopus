/**
 * @author Codex
 * @description Synchronizes the controlled Composer disabled state with Lexical's mutable editor instance.
 */

import { useLayoutEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';

export interface EditableStatePluginProps {
  editable: boolean;
}

/**
 * Applies runtime readiness changes after Lexical has consumed its immutable initial configuration.
 */
export function EditableStatePlugin({ editable }: EditableStatePluginProps) {
  const [editor] = useLexicalComposerContext();

  useLayoutEffect(() => {
    editor.setEditable(editable);
  }, [editable, editor]);

  return null;
}
