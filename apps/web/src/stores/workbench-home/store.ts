/**
 * @author Codex
 * @description Retains one unpublished conversation per workspace across browser-tab reloads until publication.
 */
import { create } from 'zustand';
import { combine, createJSONStorage, persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import type { StateStorage } from 'zustand/middleware';

/**
 * Restores tab-owned draft identities synchronously before route loaders can prepare a conversation.
 *
 * @param getStorage Supplies tab-scoped storage; injectable to reproduce full reloads in tests.
 */
export function createWorkbenchHomeStore(getStorage: () => StateStorage = () => sessionStorage) {
  return create(
    persist(
      combine({ draftIds: {} as Record<string, string> }, (set, get) => ({
        /**
         * Reuses the workspace draft through navigation, remounts, and reloads within this browser tab.
         */
        ensureDraftId(workspaceId: string): string {
          const existing = get().draftIds[workspaceId];
          if (existing !== undefined) {
            return existing;
          }
          const id = uuidv4();
          set((state) => ({ draftIds: { ...state.draftIds, [workspaceId]: id } }));
          return id;
        },
        /**
         * Replaces only the expired identity, sharing its successor across repeated recovery attempts.
         */
        renewDraftId(workspaceId: string, expiredId: string): string {
          if (get().draftIds[workspaceId] === expiredId) {
            const id = uuidv4();
            set((state) => ({ draftIds: { ...state.draftIds, [workspaceId]: id } }));
            return id;
          }
          return get().draftIds[workspaceId] ?? expiredId;
        },
        /**
         * Activates a recovered draft after the caller has protected any other current input.
         */
        resumeDraft(workspaceId: string, id: string): void {
          set({ draftIds: { ...get().draftIds, [workspaceId]: id } });
        },
        /**
         * Removes a published identity from memory and storage before the next home visit.
         */
        forgetDraft(workspaceId: string): void {
          const draftIds = { ...get().draftIds };
          delete draftIds[workspaceId];
          set({ draftIds });
        },
      })),
      {
        name: 'octopus-workbench-home',
        storage: createJSONStorage(getStorage),
        partialize: (state) => ({ draftIds: state.draftIds }),
      }
    )
  );
}

export const useWorkbenchHome = createWorkbenchHomeStore();
