/**
 * @author Claude
 * @description Declares the data-driven shortcut command catalog: stable IDs, default bindings, scopes, and pure helpers for effective bindings and conflict detection.
 */

import { isValidCombo } from './shortcut-combo';

/**
 * Dispatch scope: `global` commands fire from the window listener; `composer` commands are consumed inside the Lexical editor.
 */
export type ShortcutScope = 'global' | 'composer';

/**
 * Lifecycle status: `placeholder` commands (e.g. voice input) are display-only — never dispatched, editable, or conflicting.
 */
export type ShortcutStatus = 'active' | 'placeholder';

/** Stable command IDs; double as persistence keys, so rename is a breaking change. */
export const SHORTCUT_COMMAND_IDS = [
  'voice.toggle',
  'composer.focus',
  'composer.send',
  'composer.newline',
  'session.stop',
  'session.previous',
  'session.next',
  'session.new',
  'layout.toggleLeftSidebar',
  'layout.toggleRightPanel',
] as const;

export type ShortcutCommandId = (typeof SHORTCUT_COMMAND_IDS)[number];

const COMMAND_ID_SET = new Set<string>(SHORTCUT_COMMAND_IDS);

export interface ShortcutCommandDefinition {
  id: ShortcutCommandId;
  /** Canonical combo string; null when the command ships unbound. */
  defaultBinding: string | null;
  scope: ShortcutScope;
  status: ShortcutStatus;
  /** Fires even when focus sits in an editable element and the combo lacks Ctrl/Alt/Meta (e.g. `Shift+Esc`). */
  allowInEditable?: boolean;
}

/**
 * User binding overrides: presence wins over the catalog default; an explicit null means "cleared by user".
 */
export type ShortcutBindingOverrides = Partial<Record<ShortcutCommandId, string | null>>;

export const SHORTCUT_CATALOG: readonly ShortcutCommandDefinition[] = [
  {
    id: 'voice.toggle',
    defaultBinding: 'Ctrl+D',
    scope: 'global',
    status: 'placeholder',
  },
  {
    id: 'composer.focus',
    defaultBinding: 'Alt+I',
    scope: 'global',
    status: 'active',
  },
  {
    id: 'composer.send',
    defaultBinding: 'Enter',
    scope: 'composer',
    status: 'active',
  },
  {
    id: 'composer.newline',
    defaultBinding: 'Shift+Enter',
    scope: 'composer',
    status: 'active',
  },
  {
    id: 'session.stop',
    defaultBinding: 'Shift+Esc',
    scope: 'global',
    status: 'active',
    allowInEditable: true,
  },
  {
    id: 'session.previous',
    defaultBinding: 'Ctrl+[',
    scope: 'global',
    status: 'active',
  },
  {
    id: 'session.next',
    defaultBinding: 'Ctrl+]',
    scope: 'global',
    status: 'active',
  },
  {
    id: 'session.new',
    defaultBinding: 'Alt+N',
    scope: 'global',
    status: 'active',
  },
  {
    id: 'layout.toggleLeftSidebar',
    defaultBinding: 'Ctrl+B',
    scope: 'global',
    status: 'active',
  },
  {
    id: 'layout.toggleRightPanel',
    defaultBinding: 'Ctrl+Shift+B',
    scope: 'global',
    status: 'active',
  },
];

const DEFINITIONS_BY_ID = new Map<ShortcutCommandId, ShortcutCommandDefinition>(
  SHORTCUT_CATALOG.map((definition) => [definition.id, definition])
);

/**
 * Looks up a command definition.
 *
 * @param id Command ID.
 * @returns The catalog definition; throws for unknown IDs so typos fail loudly at development time.
 */
export function getCommandDefinition(id: ShortcutCommandId): ShortcutCommandDefinition {
  const definition = DEFINITIONS_BY_ID.get(id);
  if (definition === undefined) {
    throw new Error(`Unknown shortcut command: ${id}`);
  }
  return definition;
}

/**
 * Type guard for strings arriving from persistence.
 *
 * @param value Raw stored key.
 * @returns True when the value is a known command ID.
 */
export function isShortcutCommandId(value: string): value is ShortcutCommandId {
  return COMMAND_ID_SET.has(value);
}

/**
 * Resolves the binding currently in effect for a command.
 *
 * @param overrides User overrides from the shortcuts store.
 * @param id Command ID.
 * @returns The override when present (null = cleared), otherwise the catalog default.
 */
export function resolveEffectiveBinding(
  overrides: ShortcutBindingOverrides,
  id: ShortcutCommandId
): string | null {
  return id in overrides ? (overrides[id] ?? null) : getCommandDefinition(id).defaultBinding;
}

/**
 * Finds another active command in the same scope already occupying a combo.
 *
 * @param overrides User overrides from the shortcuts store.
 * @param id Command being edited (excluded from the check).
 * @param combo Candidate combo to claim.
 * @returns The conflicting command ID, or undefined when the combo is free.
 */
export function findBindingConflict(
  overrides: ShortcutBindingOverrides,
  id: ShortcutCommandId,
  combo: string
): ShortcutCommandId | undefined {
  const scope = getCommandDefinition(id).scope;
  return SHORTCUT_CATALOG.find(
    (definition) =>
      definition.id !== id &&
      definition.scope === scope &&
      definition.status === 'active' &&
      resolveEffectiveBinding(overrides, definition.id) === combo
  )?.id;
}

/**
 * Drops unknown command IDs and malformed combos from rehydrated persistence.
 *
 * @param value Raw persisted overrides object.
 * @returns Sanitized overrides safe for dispatch.
 */
export function sanitizeShortcutOverrides(value: unknown): ShortcutBindingOverrides {
  if (typeof value !== 'object' || value === null) {
    return {};
  }
  const sanitized: ShortcutBindingOverrides = {};
  for (const [key, binding] of Object.entries(value)) {
    if (!isShortcutCommandId(key)) {
      continue;
    }
    if (binding === null || (typeof binding === 'string' && isValidCombo(binding))) {
      sanitized[key] = binding;
    }
  }
  return sanitized;
}
