/**
 * @author Codex
 * @description Persists dismissed background-task snapshots per session in browser-local storage.
 */
import { create } from 'zustand';
import { combine, createJSONStorage, persist } from 'zustand/middleware';
import type { StateStorage } from 'zustand/middleware';

/**
 * Creates the background-task presentation store with injectable storage for deterministic tests.
 *
 * @param getStorage Supplies browser-local storage or a compatible test implementation.
 * @returns A Zustand hook whose dismissed snapshots survive page reloads.
 */
export function createBackgroundTasksStore(getStorage: () => StateStorage = () => localStorage) {
  return create(
    persist(
      combine({ dismissedSnapshots: {} as Record<string, string> }, (set) => ({
        /**
         * Remembers the exact settled snapshot hidden by the user for one session.
         *
         * @param sessionId Session whose background-task entry is being hidden.
         * @param snapshotKey Runtime generation and revision visible at dismissal time.
         */
        dismissSnapshot(sessionId: string, snapshotKey: string): void {
          set((state) => ({
            dismissedSnapshots: { ...state.dismissedSnapshots, [sessionId]: snapshotKey },
          }));
        },
        /**
         * Clears a stale dismissal when the session starts new background work.
         *
         * @param sessionId Session whose task entry must become visible again.
         */
        clearDismissedSnapshot(sessionId: string): void {
          set((state) => {
            if (!(sessionId in state.dismissedSnapshots)) {
              return state;
            }
            const dismissedSnapshots = { ...state.dismissedSnapshots };
            delete dismissedSnapshots[sessionId];
            return { dismissedSnapshots };
          });
        },
      })),
      {
        name: 'octopus-background-tasks',
        storage: createJSONStorage(getStorage),
        partialize: (state) => ({ dismissedSnapshots: state.dismissedSnapshots }),
      }
    )
  );
}

export const useBackgroundTasksStore = createBackgroundTasksStore();
