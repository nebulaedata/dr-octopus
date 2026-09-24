/**
 * @author Codex
 * @description Owns validated, device-local quick phrases and their bound Agent work modes.
 */
import { create } from 'zustand';
import { combine, createJSONStorage, persist } from 'zustand/middleware';
import { z } from 'zod';
import type { StateStorage } from 'zustand/middleware';

export const MAX_SNIPPETS = 4;
export const snippetSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(60),
  message: z.string().trim().min(1).max(4000),
  workMode: z.enum(['agent', 'plan', 'knowledge']),
  action: z.enum(['send', 'fill']).default('send'),
});
export type Snippet = z.infer<typeof snippetSchema>;
const snippetsSchema = z.array(snippetSchema).max(MAX_SNIPPETS);

/**
 * Creates durable settings with injectable storage for reload and validation checks.
 */
export function createSnippetsStore(getStorage: () => StateStorage = () => localStorage) {
  return create(
    persist(
      combine({ snippets: [] as Snippet[] }, (set) => ({
        /**
         * Atomically saves at most four complete phrases; invalid input leaves settings untouched.
         */
        save(snippets: Snippet[]) {
          set({ snippets: snippetsSchema.parse(snippets) });
        },
      })),
      {
        name: 'dr-octopus.snippets.v1',
        storage: createJSONStorage(getStorage),
        partialize: (state) => ({ snippets: state.snippets }),
        merge: (persisted, current) => {
          const result = z.object({ snippets: snippetsSchema }).safeParse(persisted);
          return { ...current, snippets: result.success ? result.data.snippets : [] };
        },
      }
    )
  );
}

export const useSnippets = createSnippetsStore();
