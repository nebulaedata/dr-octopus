/**
 * @author Claude
 * @description Persists user shortcut binding overrides in localStorage and exposes semantic actions; this module is the only allowed reader/writer of the shortcuts storage record.
 */

import { create } from 'zustand';
import { combine, createJSONStorage, persist } from 'zustand/middleware';
import { sanitizeShortcutOverrides } from '@/lib/shortcuts/shortcut-catalog';
import type { ShortcutBindingOverrides, ShortcutCommandId } from '@/lib/shortcuts/shortcut-catalog';

export const SHORTCUT_BINDINGS_STORAGE_KEY = 'dr-octopus.shortcuts.bindings.v1';

interface ShortcutsState {
  overrides: ShortcutBindingOverrides;
}

interface ShortcutsActions {
  /**
   * Records a custom combo for a command.
   *
   * @param id Command ID.
   * @param combo Canonical combo string.
   */
  setBinding(id: ShortcutCommandId, combo: string): void;
  /**
   * Marks a command unbound (override null); the default is not restored.
   *
   * @param id Command ID.
   */
  clearBinding(id: ShortcutCommandId): void;
  /**
   * Drops a command's override so its catalog default applies again.
   *
   * @param id Command ID.
   */
  resetBinding(id: ShortcutCommandId): void;
  /**
   * Drops every override, restoring catalog defaults globally.
   */
  resetAll(): void;
}

export const useShortcutsStore = create(
  persist(
    combine<ShortcutsState, ShortcutsActions>({ overrides: {} }, (set) => ({
      setBinding: (id, combo) => set((state) => ({ overrides: { ...state.overrides, [id]: combo } })),
      clearBinding: (id) => set((state) => ({ overrides: { ...state.overrides, [id]: null } })),
      resetBinding: (id) =>
        set((state) => {
          const overrides = { ...state.overrides };
          delete overrides[id];
          return { overrides };
        }),
      resetAll: () => set({ overrides: {} }),
    })),
    {
      name: SHORTCUT_BINDINGS_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ overrides: state.overrides }),
      merge: (persisted, current) => ({
        ...current,
        overrides: sanitizeShortcutOverrides(
          typeof persisted === 'object' && persisted !== null
            ? (persisted as Partial<ShortcutsState>).overrides
            : undefined
        ),
      }),
    }
  )
);
