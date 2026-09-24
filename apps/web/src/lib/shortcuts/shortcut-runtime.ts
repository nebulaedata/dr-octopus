/**
 * @author Codex
 * @description Owns the browser shortcut singleton, persisted binding synchronization and hot-reload listener teardown.
 */

import { useShortcutsStore } from '@/stores/shortcuts';
import { ShortcutKeyRegister } from './shortcut-key-register';

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
