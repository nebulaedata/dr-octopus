/**
 * @author Codex
 * @description Retains the promotional card dismissal through navigation and responsive remounts until reload.
 */

import { create } from 'zustand';
import { combine } from 'zustand/middleware';

export const useExecutorDownloadStore = create(
  combine({ dismissed: false }, (set) => ({
    /**
     * Hides the card for this page lifetime without persisting a device or tab preference.
     */
    dismiss() {
      set({ dismissed: true });
    },
  }))
);
