/**
 * @author Codex
 * @description Synchronizes an externally replaced Composer draft back into the Lexical editor.
 */

import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';

export interface DraftSyncPluginProps {
  value: string;
}

/**
 * Applies an externally replaced draft, including the empty value emitted after submission.
 */
export function DraftSyncPlugin({ value }: DraftSyncPluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.update(() => {
      const root = $getRoot();
      if (root.getTextContent() === value) {
        return;
      }
      root.clear();
      root.append($createParagraphNode().append($createTextNode(value)));
      root.selectEnd();
    });
  }, [editor, value]);

  return null;
}
