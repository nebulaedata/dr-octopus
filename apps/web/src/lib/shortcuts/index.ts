/**
 * @author Claude
 * @description Wires the ShortcutKeyRegister singleton to the persisted overrides store and exposes the React hooks features use to register handlers and read bindings.
 */

import { useEffect } from 'react';
import { useLatest } from 'ahooks';
import { useShortcutsStore } from '@/stores/shortcuts';
import { resolveEffectiveBinding } from './shortcut-catalog';
import { ShortcutKeyRegister } from './shortcut-key-register';
import type { ShortcutCommandId } from './shortcut-catalog';
import type { ShortcutHandler } from './shortcut-key-register';

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

/**
 * Application-wide shortcut registry; starts listening on import and follows persisted overrides.
 */
export const shortcutKey = new ShortcutKeyRegister();
shortcutKey.start();
shortcutKey.syncOverrides(useShortcutsStore.getState().overrides);

useShortcutsStore.subscribe((state, previousState) => {
  if (state.overrides !== previousState.overrides) {
    shortcutKey.syncOverrides(state.overrides);
  }
});

// HMR re-executes this module; detach the previous listener so window never accumulates duplicates.
if (import.meta.hot) {
  import.meta.hot.dispose(() => shortcutKey.stop());
}

export interface UseShortcutOptions {
  /** When false, no handler is registered (e.g. stop-generation while idle). Defaults to true. */
  enabled?: boolean;
}

/**
 * Registers a shortcut handler for the component's lifetime.
 *
 * @param commandId Command ID (use the static constants, e.g. `ShortcutKeyRegister.NEW_SESSION`).
 * @param handler Callback kept fresh via ref, so closures always see the latest render.
 * @param options Set `enabled: false` to suspend registration without unmounting the hook.
 */
export function useShortcut(
  commandId: ShortcutCommandId,
  handler: ShortcutHandler,
  options?: UseShortcutOptions
): void {
  const enabled = options?.enabled ?? true;
  const latestHandler = useLatest(handler);
  useEffect(() => {
    if (!enabled) {
      return;
    }
    return shortcutKey.register(commandId, (event) => latestHandler.current(event));
  }, [commandId, enabled, latestHandler]);
}

/**
 * Reactively reads a command's effective binding for display (settings rows, tooltips, aria hints).
 *
 * @param commandId Command ID.
 * @returns The effective combo string, or null when unbound.
 */
export function useShortcutBinding(commandId: ShortcutCommandId): string | null {
  const overrides = useShortcutsStore((state) => state.overrides);
  return resolveEffectiveBinding(overrides, commandId);
}
