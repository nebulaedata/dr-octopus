/**
 * @author Codex
 * @description Exposes shortcut infrastructure while preserving the shared runtime initialization on import.
 */

export { ShortcutKeyRegister } from './shortcut-key-register';
export type {
  ShortcutCommandView,
  ShortcutHandler,
  ShortcutKeyRegisterOptions,
} from './shortcut-key-register';
export {
  findBindingConflict,
  getCommandDefinition,
  resolveEffectiveBinding,
  SHORTCUT_CATALOG,
} from './shortcut-catalog';
export type { ShortcutCommandDefinition, ShortcutCommandId } from './shortcut-catalog';
export { comboMatches, normalizeEvent, toAriaKeyShortcuts } from './shortcut-combo';

export { shortcutKey } from './shortcut-runtime';
