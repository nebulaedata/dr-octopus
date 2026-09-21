/**
 * @author Codex
 * @description Matches @ queries and replaces them with atomic file or directory mention nodes.
 */

import { useCallback, useState } from 'react';
import { FileIcon, FolderIcon } from 'lucide-react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from '@lexical/react/LexicalTypeaheadMenuPlugin';
import { $createTextNode } from 'lexical';
import { $createFileMentionNode } from './file-mention-node';
import { createTypeaheadPopoverRenderer } from './typeahead-popover';
import { buildWorkspaceReferenceCatalog } from './workspace-reference-catalog';
import { SLASH_COMMAND_PUNCTUATION, WORKSPACE_REFERENCE_PUNCTUATION } from '../typeahead-punctuation';
import type { ComposerReference } from '@/components/AgentComposerEditor/types';

const MAX_OPTIONS = 8;

class MentionOption extends MenuOption {
  readonly group: string;
  readonly reference: ComposerReference;
  readonly label: string;
  readonly description: string;
  readonly iconComponent: typeof FileIcon;

  /**
   * Creates one menu option with a stable path identity.
   */
  constructor(reference: ComposerReference) {
    super(`${reference.kind}:${reference.path}`);
    this.reference = reference;
    this.group = reference.kind === 'directory' ? 'Folders' : 'Files';
    this.label = reference.label;
    this.description = reference.path;
    this.iconComponent = reference.kind === 'directory' ? FolderIcon : FileIcon;
  }
}

export interface WorkspaceMentionsPluginProps {
  references: ComposerReference[];
  /**
   * Reports whether the Workspace mention menu is open.
   */
  onMenuOpenChange(open: boolean): void;
}

/**
 * Provides Workspace reference lookup without coupling the editor to a business data source.
 */
export function WorkspaceMentionsPlugin({ references, onMenuOpenChange }: WorkspaceMentionsPluginProps) {
  const [editor] = useLexicalComposerContext();
  const renderMentionMenu = createTypeaheadPopoverRenderer<MentionOption>(
    'No matching files or folders.',
    editor
  );
  const [query, setQuery] = useState<string | null>(null);
  const mentionMatch = useBasicTypeaheadTriggerMatch('@', {
    minLength: 0,
    maxLength: 120,
    punctuation: WORKSPACE_REFERENCE_PUNCTUATION,
    allowWhitespace: true,
  });
  const slashMatch = useBasicTypeaheadTriggerMatch('/', {
    minLength: 0,
    maxLength: 120,
    punctuation: SLASH_COMMAND_PUNCTUATION,
    allowWhitespace: false,
  });
  const triggerFn = useCallback(
    (text: string, lexicalEditor: typeof editor) =>
      slashMatch(text, lexicalEditor) === null ? mentionMatch(text, lexicalEditor) : null,
    [mentionMatch, slashMatch]
  );
  const options = buildWorkspaceReferenceCatalog(references, query, MAX_OPTIONS).map(
    (reference) => new MentionOption(reference)
  );

  return (
    <LexicalTypeaheadMenuPlugin
      triggerFn={triggerFn}
      options={options}
      onQueryChange={setQuery}
      onOpen={() => onMenuOpenChange(true)}
      onClose={() => onMenuOpenChange(false)}
      onSelectOption={(option, nodeToReplace, closeMenu) => {
        editor.update(() => {
          const mention = $createFileMentionNode(option.reference);
          if (nodeToReplace === null) {
            return;
          }
          nodeToReplace.replace(mention);
          mention.insertAfter($createTextNode(' '));
          mention.selectNext();
          closeMenu();
        });
      }}
      menuRenderFn={renderMentionMenu}
    />
  );
}
