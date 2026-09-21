/**
 * @author Codex
 * @description Composes the generic Lexical drafting surface, file mentions, slash commands, history, and submission shortcuts.
 */

import { useState } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { FileMentionNode } from './plugins/workspace-mentions-plugin/file-mention-node';
import { ComposerChangePlugin } from './plugins/composer-change-plugin';
import { DraftSyncPlugin } from './plugins/draft-sync-plugin';
import { EditableStatePlugin } from './plugins/editable-state-plugin';
import { EditorHandlePlugin } from './plugins/editor-handle-plugin';
import { SubmitShortcutPlugin } from './plugins/submit-shortcut-plugin';
import { SlashCommandsPlugin } from './plugins/slash-command-plugin';
import { WorkspaceMentionsPlugin } from './plugins/workspace-mentions-plugin';
import type { Ref } from 'react';
import type { AgentComposerEditorHandle, ComposerCommand, ComposerDraft, ComposerReference } from './types';

export type { AgentComposerEditorHandle } from './types';

export interface AgentComposerEditorProps {
  ref?: Ref<AgentComposerEditorHandle>;
  value: string;
  placeholder: string;
  references: ComposerReference[];
  commands: ComposerCommand[];
  disabled?: boolean;
  /**
   * Decides whether an Enter gesture submits; supplied by the feature layer so user bindings apply.
   */
  isSubmitEvent(event: KeyboardEvent): boolean;
  /**
   * aria-keyshortcuts hint reflecting the current send/newline bindings.
   */
  keyShortcutsHint: string;
  /**
   * Receives each structured editor-state change.
   */
  onChange(draft: ComposerDraft): void;
  /**
   * Submits the current structured draft.
   */
  onSubmit(draft: ComposerDraft, alternate: boolean): void;
  /**
   * Executes a non-prompt command selected from the slash menu.
   */
  onCommand(command: ComposerCommand): void;
}

/**
 * Surfaces editor failures to the nearest React error boundary.
 */
function handleEditorError(error: Error): never {
  throw error;
}

/**
 * Provides an accessible multiline Agent editor with atomic mentions and caret-anchored command discovery.
 */
export function AgentComposerEditor({
  ref,
  value,
  placeholder,
  references,
  commands,
  disabled = false,
  isSubmitEvent,
  keyShortcutsHint,
  onChange,
  onSubmit,
  onCommand,
}: AgentComposerEditorProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const initialConfig = {
    namespace: 'OctopusAgentComposer',
    nodes: [FileMentionNode],
    editable: !disabled,
    onError: handleEditorError,
    editorState: () => {
      const root = $getRoot();
      root.clear();
      root.append($createParagraphNode().append($createTextNode(value)));
    },
  };

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="relative">
        <PlainTextPlugin
          contentEditable={
            <ContentEditable
              aria-label="Message Dr.Octopus"
              aria-disabled={disabled}
              aria-keyshortcuts={keyShortcutsHint}
              className="max-h-60 min-h-20 overflow-y-auto px-4 pt-4 pb-2 text-sm outline-none whitespace-pre-wrap"
            />
          }
          placeholder={
            <div className="pointer-events-none absolute top-4 left-4 text-sm text-muted-foreground">
              {placeholder}
            </div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <EditableStatePlugin editable={!disabled} />
        <ComposerChangePlugin onChange={onChange} />
        <DraftSyncPlugin value={value} />
        <EditorHandlePlugin handleRef={ref} />
        <WorkspaceMentionsPlugin references={references} onMenuOpenChange={setMenuOpen} />
        <SlashCommandsPlugin commands={commands} onMenuOpenChange={setMenuOpen} onCommand={onCommand} />
        <SubmitShortcutPlugin menuOpen={menuOpen} isSubmitEvent={isSubmitEvent} onSubmit={onSubmit} />
      </div>
    </LexicalComposer>
  );
}
