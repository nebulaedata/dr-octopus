/**
 * @author Codex
 * @description Defines the shared punctuation contracts that keep typeahead triggers mutually exclusive.
 */

import { PUNCTUATION } from '@lexical/react/LexicalTypeaheadMenuPlugin';

export const SLASH_COMMAND_PUNCTUATION = PUNCTUATION.replace('\\-', '').replace(':', '');
export const WORKSPACE_REFERENCE_PUNCTUATION = '';
