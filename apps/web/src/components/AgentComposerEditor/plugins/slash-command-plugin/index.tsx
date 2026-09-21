/**
 * @author Codex
 * @description Matches slash queries and inserts existing Agent command invocations through an inline Popover.
 */

import { useCallback, useState } from 'react';
import { useMemoizedFn } from 'ahooks';
import { createPortal } from 'react-dom';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  LexicalTypeaheadMenuPlugin,
  useBasicTypeaheadTriggerMatch,
} from '@lexical/react/LexicalTypeaheadMenuPlugin';
import { $createTextNode } from 'lexical';
import { formatCommandInsertion } from '@/components/AgentComposerEditor/command-insertion';
import { buildSlashCommandCatalog } from './slash-command-catalog';
import { SlashCommandMenu } from './slash-command-popover';
import { SLASH_COMMAND_PUNCTUATION, WORKSPACE_REFERENCE_PUNCTUATION } from '../typeahead-punctuation';
import type { MenuRenderFn } from '@lexical/react/LexicalTypeaheadMenuPlugin';
import type { SlashCommandOption } from './slash-command-catalog';
import type { ComposerCommand } from '@/components/AgentComposerEditor/types';

export interface SlashCommandsPluginProps {
  commands: ComposerCommand[];
  /**
   * Reports whether the slash-command menu is open.
   */
  onMenuOpenChange(open: boolean): void;
  /**
   * Executes a Host command after Lexical removes its trigger text.
   */
  onCommand(command: ComposerCommand): void;
}

/**
 * Preserves the existing slash command behavior while moving discovery next to the caret.
 */
export function SlashCommandsPlugin({ commands, onMenuOpenChange, onCommand }: SlashCommandsPluginProps) {
  const [editor] = useLexicalComposerContext();
  const [query, setQuery] = useState<string | null>(null);
  const slashMatch = useBasicTypeaheadTriggerMatch('/', {
    minLength: 0,
    maxLength: 120,
    punctuation: SLASH_COMMAND_PUNCTUATION,
    allowWhitespace: false,
  });
  const mentionMatch = useBasicTypeaheadTriggerMatch('@', {
    minLength: 0,
    maxLength: 120,
    punctuation: WORKSPACE_REFERENCE_PUNCTUATION,
    allowWhitespace: true,
  });
  const triggerFn = useCallback(
    (text: string, lexicalEditor: typeof editor) =>
      mentionMatch(text, lexicalEditor) === null ? slashMatch(text, lexicalEditor) : null,
    [mentionMatch, slashMatch]
  );
  const catalog = buildSlashCommandCatalog(commands, query);
  const renderCommandMenu: MenuRenderFn<SlashCommandOption> = useMemoizedFn((anchorElementRef, menuProps) => {
    const anchor = anchorElementRef.current;
    return anchor === null
      ? null
      : createPortal(<SlashCommandMenu catalog={catalog} {...menuProps} />, anchor);
  });

  return (
    <LexicalTypeaheadMenuPlugin
      triggerFn={triggerFn}
      options={catalog.options}
      onQueryChange={setQuery}
      onOpen={() => onMenuOpenChange(true)}
      onClose={() => onMenuOpenChange(false)}
      onSelectOption={(option, nodeToReplace, closeMenu) => {
        if (nodeToReplace === null) {
          return;
        }
        const executesPrompt = option.command.execution === 'prompt';
        editor.update(() => {
          if (executesPrompt) {
            const command = $createTextNode(formatCommandInsertion(option.command.name, false));
            nodeToReplace.replace(command);
            command.selectEnd();
          } else {
            nodeToReplace.remove();
          }
        });
        closeMenu();
        if (!executesPrompt) {
          onCommand(option.command);
        }
      }}
      menuRenderFn={renderCommandMenu}
    />
  );
}
