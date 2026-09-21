/**
 * @author Codex
 * @description Defines the domain-neutral contracts accepted and emitted by the Lexical Agent Composer.
 */

export type ComposerReferenceKind = 'file' | 'directory';
export type ComposerTrigger = '/' | '@';

export interface AgentComposerEditorHandle {
  /**
   * Restores editor focus and its selection without changing the draft.
   */
  focus(): void;
  /**
   * Focuses the editor and inserts a boundary-safe typeahead trigger at its current selection.
   */
  insertTrigger(trigger: ComposerTrigger): void;
  /**
   * Focuses the editor and inserts one complete slash command at its current selection.
   */
  insertCommand(commandName: string): void;
}

export interface ComposerReference {
  path: string;
  kind: ComposerReferenceKind;
  label: string;
}

export interface ComposerCommand {
  name: string;
  description?: string;
  group: string;
  execution: 'prompt' | 'realtime' | 'http' | 'client';
  enabled: boolean;
  disabledReason?: string;
}

export interface ComposerDraft {
  text: string;
  references: ComposerReference[];
}
