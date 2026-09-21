/**
 * @author Claude
 * @description Normalizes KeyboardEvent gestures into canonical combo strings ("Ctrl+Shift+B") and back; pure and DOM-free so dispatch, persistence, and tests share one contract.
 */

/**
 * Structural subset of KeyboardEvent that normalization needs; keeps the module usable with synthetic events in tests.
 */
export interface ShortcutKeyboardEvent {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/** Modifier tokens in canonical display/order; Alt sits between Ctrl and Shift. */
const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;

type ModifierToken = (typeof MODIFIER_ORDER)[number];

const MODIFIER_KEY_NAMES = new Set(['Control', 'Alt', 'Shift', 'Meta']);

/**
 * Physical-key tokens keyed by `event.code`, keeping combos like `Ctrl+[` stable across keyboard layouts and Shift states.
 */
const CODE_TOKENS: Record<string, string> = {
  ...Object.fromEntries(
    Array.from({ length: 26 }, (_, index) => [
      `Key${String.fromCharCode(65 + index)}`,
      String.fromCharCode(65 + index),
    ])
  ),
  ...Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`Digit${index}`, `${index}`])),
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  Backslash: '\\',
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Escape: 'Esc',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  ...Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`F${index + 1}`, `F${index + 1}`])),
};

/**
 * Fallback tokens keyed by `event.key` for named keys whose `code` is missing (IME-adjacent or synthetic events).
 */
const KEY_NAME_TOKENS: Record<string, string> = {
  ' ': 'Space',
  Spacebar: 'Space',
  Enter: 'Enter',
  Escape: 'Esc',
  Esc: 'Esc',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  ...Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`F${index + 1}`, `F${index + 1}`])),
};

const MAIN_KEY_TOKENS = new Set([...Object.values(CODE_TOKENS), ...Object.values(KEY_NAME_TOKENS)]);

export interface NormalizeOptions {
  /** Drops Alt from the produced combo, modelling "Alt+<send combo>" as the alternate-submit gesture. */
  ignoreAlt?: boolean;
}

/**
 * Converts a keyboard event into its canonical combo string.
 *
 * @param event Keyboard event (or structural equivalent) to normalize.
 * @param options Set `ignoreAlt` to compare gestures while treating Alt as an orthogonal mode modifier.
 * @returns Canonical combo such as `Ctrl+Shift+B`, or null for modifier-only presses and unrecognized keys.
 */
export function normalizeEvent(event: ShortcutKeyboardEvent, options?: NormalizeOptions): string | null {
  if (MODIFIER_KEY_NAMES.has(event.key) || event.key === 'Dead' || event.key === 'Unidentified') {
    return null;
  }
  const mainKey =
    CODE_TOKENS[event.code] ??
    (event.key.length === 1 ? event.key.toUpperCase() : KEY_NAME_TOKENS[event.key]);
  if (mainKey === undefined) {
    return null;
  }
  const modifiers: ModifierToken[] = [];
  if (event.ctrlKey) {
    modifiers.push('Ctrl');
  }
  if (event.altKey && options?.ignoreAlt !== true) {
    modifiers.push('Alt');
  }
  if (event.shiftKey) {
    modifiers.push('Shift');
  }
  if (event.metaKey) {
    modifiers.push('Meta');
  }
  return [...modifiers, mainKey].join('+');
}

export interface ParsedCombo {
  modifiers: ModifierToken[];
  mainKey: string;
}

/**
 * Splits a combo string into ordered modifiers and its main key.
 *
 * @param combo Candidate combo string.
 * @returns Parsed parts, or null when modifiers are unknown, duplicated, out of canonical order, or the main key is a modifier/empty.
 */
export function parseCombo(combo: string): ParsedCombo | null {
  const parts = combo.split('+');
  const mainKey = parts[parts.length - 1];
  if (mainKey === '' || (MODIFIER_ORDER as readonly string[]).includes(mainKey)) {
    return null;
  }
  const modifiers = parts.slice(0, -1);
  let previousIndex = -1;
  for (const modifier of modifiers) {
    const index = (MODIFIER_ORDER as readonly string[]).indexOf(modifier);
    if (index === -1 || index <= previousIndex) {
      return null;
    }
    previousIndex = index;
  }
  return { modifiers: modifiers as ModifierToken[], mainKey };
}

/**
 * Reports whether a persisted string is a combo the normalizer could actually produce.
 *
 * @param combo Candidate combo string from user recording or storage.
 * @returns True when modifiers parse and the main key is a known token or an uppercase single character.
 */
export function isValidCombo(combo: string): boolean {
  const parsed = parseCombo(combo);
  if (parsed === null) {
    return false;
  }
  if (parsed.mainKey.length === 1) {
    return parsed.mainKey === parsed.mainKey.toUpperCase();
  }
  return MAIN_KEY_TOKENS.has(parsed.mainKey);
}

/**
 * Checks an event against a stored combo.
 *
 * @param event Keyboard event to test.
 * @param combo Canonical combo string.
 * @param options Set `ignoreAlt` so `Alt+Enter` still matches a plain `Enter` binding (alternate-submit).
 * @returns True when the normalized event equals the combo.
 */
export function comboMatches(
  event: ShortcutKeyboardEvent,
  combo: string,
  options?: NormalizeOptions
): boolean {
  return normalizeEvent(event, options) === combo;
}

/**
 * Reports whether a combo carries Ctrl/Alt/Meta, i.e. can never type text into an editable target.
 *
 * @param combo Canonical combo string.
 * @returns True when a strong modifier is present and the editable-focus guard should not apply.
 */
export function comboHasStrongModifier(combo: string): boolean {
  const parsed = parseCombo(combo);
  return parsed !== null && parsed.modifiers.some((modifier) => modifier !== 'Shift');
}

/** aria-keyshortcuts uses long modifier names; everything else stays identical to the canonical token. */
const ARIA_TOKEN_NAMES: Record<string, string> = { Ctrl: 'Control', Esc: 'Escape' };

/**
 * Converts a canonical combo into the aria-keyshortcuts attribute format.
 *
 * @param combo Canonical combo string.
 * @returns Attribute token such as `Control+Shift+B`.
 */
export function toAriaKeyShortcuts(combo: string): string {
  return combo
    .split('+')
    .map((token) => ARIA_TOKEN_NAMES[token] ?? token)
    .join('+');
}
