/**
 * @author Codex
 * @description Defines the shared plain-text representation inserted for one selected slash command.
 */

/**
 * Formats a slash command with a safe leading boundary and a trailing argument space.
 *
 * @param commandName Command name without the slash prefix.
 * @param hasEditorContent Whether the current editor already contains user-authored content.
 * @returns Text ready for insertion at the active Lexical selection.
 */
export function formatCommandInsertion(commandName: string, hasEditorContent: boolean): string {
  return `${hasEditorContent ? ' ' : ''}/${commandName} `;
}
