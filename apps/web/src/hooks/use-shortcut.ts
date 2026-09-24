/**
 * @author Codex
 * @description Binds shortcut handlers and effective bindings to React component lifecycles.
 */

import { useEffect } from 'react';
import { useLatest } from 'ahooks';
import { useShortcutsStore } from '@/stores/shortcuts';
import { resolveEffectiveBinding, shortcutKey } from '@/lib/shortcuts';
import type { ShortcutCommandId, ShortcutHandler } from '@/lib/shortcuts';

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
