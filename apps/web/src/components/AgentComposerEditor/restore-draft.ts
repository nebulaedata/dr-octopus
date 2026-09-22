/**
 * @author Codex
 * @description Restores structured mention nodes from saved text and explicit references without storing editor internals on the server.
 */
import { createEditor, $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import {
  FileMentionNode,
  $createFileMentionNode,
} from './plugins/workspace-mentions-plugin/file-mention-node';
import { $buildComposerDraft } from './plugins/composer-draft';
import type { ComposerDraft, ComposerReference } from './types';

/**
 * Recovers one mention per explicit reference; unmatched references remain visible at the end of the draft.
 */
export function restoreComposerDraft(text: string, references: ComposerReference[]): ComposerDraft {
  const editor = createEditor({
    nodes: [FileMentionNode],
    onError: (error) => {
      throw error;
    },
  });
  editor.update(
    () => {
      const paragraph = $createParagraphNode();
      const remaining = [...references].sort((a, b) => b.path.length - a.path.length);
      let offset = 0;
      while (remaining.length) {
        const found = remaining
          .map((reference) => ({ reference, index: text.indexOf(`@${reference.path}`, offset) }))
          .filter((item) => item.index >= 0)
          .sort((a, b) => a.index - b.index)[0];
        if (!found) {
          break;
        }
        paragraph.append(
          $createTextNode(text.slice(offset, found.index)),
          $createFileMentionNode(found.reference)
        );
        offset = found.index + found.reference.path.length + 1;
        remaining.splice(remaining.indexOf(found.reference), 1);
      }
      paragraph.append($createTextNode(text.slice(offset)));
      for (const reference of remaining) {
        paragraph.append($createTextNode(' '), $createFileMentionNode(reference));
      }
      $getRoot().clear().append(paragraph);
    },
    { discrete: true }
  );
  return {
    ...editor.getEditorState().read($buildComposerDraft),
    editorState: JSON.stringify(editor.getEditorState().toJSON()),
  };
}
