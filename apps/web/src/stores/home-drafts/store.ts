/**
 * @author Codex
 * @description Persists unsent editor state and stable submission identities independently of Agent processes.
 */
import { create } from 'zustand';
import { combine, createJSONStorage, persist } from 'zustand/middleware';
import type { StateStorage } from 'zustand/middleware';
import type { ComposerDraft } from '@/components/AgentComposerEditor/types';
import type { ConversationStartInput, ModelSelection, DraftControls } from '@octopus/shared/protocol';

export interface HomeDraft {
  editor: ComposerDraft;
  selection: ModelSelection;
  controls?: DraftControls;
  version: number;
  submission?: ConversationStartInput;
}
export const emptyHomeDraft: HomeDraft = {
  editor: { text: '', references: [] },
  selection: { mode: 'follow-default' },
  version: 0,
};
/**
 * Creates a tab-owned durable editor store with injectable storage for reload verification.
 */
export function createHomeDraftStore(getStorage: () => StateStorage = () => sessionStorage) {
  return create(
    persist(
      combine({ drafts: {} as Record<string, HomeDraft> }, (set, get) => ({
        /**
         * Preserves first-turn control choices while no runtime exists.
         */
        controls(id: string, update: DraftControls) {
          const previous = get().drafts[id] ?? emptyHomeDraft;
          set({
            drafts: {
              ...get().drafts,
              [id]: {
                ...previous,
                controls: { ...previous.controls, ...update },
                version: previous.version + 1,
              },
            },
          });
        },
        /**
         * Retains structured mentions together with text and a monotonic editing version.
         */
        edit(id: string, editor: ComposerDraft) {
          const previous = get().drafts[id] ?? emptyHomeDraft;
          if (JSON.stringify(previous.editor) === JSON.stringify(editor)) {
            return;
          }
          set({ drafts: { ...get().drafts, [id]: { ...previous, editor, version: previous.version + 1 } } });
        },
        /**
         * Stores selection intent; only follow-default responds to global default changes.
         */
        select(id: string, selection: ModelSelection) {
          const previous = get().drafts[id] ?? emptyHomeDraft;
          set({
            drafts: { ...get().drafts, [id]: { ...previous, selection, version: previous.version + 1 } },
          });
        },
        /**
         * Saves request identity before making HTTP requests, including across page reloads.
         */
        submission(id: string, submission?: ConversationStartInput) {
          set({ drafts: { ...get().drafts, [id]: { ...(get().drafts[id] ?? emptyHomeDraft), submission } } });
        },
        /**
         * Discards only the submitted version; edits made afterwards remain a new draft.
         */
        accepted(id: string, version: number) {
          const previous = get().drafts[id];
          const drafts = { ...get().drafts };
          if (previous?.version === version) {
            delete drafts[id];
          } else if (previous) {
            drafts[id] = { ...previous, submission: undefined };
          }
          set({ drafts });
        },
      })),
      { name: 'octopus-home-drafts', storage: createJSONStorage(getStorage) }
    )
  );
}

export const useHomeDrafts = createHomeDraftStore();
