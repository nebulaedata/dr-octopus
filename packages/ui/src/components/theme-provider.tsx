/**
 * @author Codex
 * @description Provides persistent color-theme and light/dark mode state for browser applications.
 */

import { useEffect, useLayoutEffect, useState } from 'react';
import {
  applyTheme,
  DEFAULT_THEME_STORAGE_KEY,
  readStoredPreferences,
  ThemeContext,
} from '@octopus/ui/lib/theme';
import type { ColorTheme, ThemeMode, ThemePreferences } from '@octopus/ui/lib/theme';
import type { PropsWithChildren } from 'react';

export interface ThemeProviderProps extends PropsWithChildren {
  defaultMode?: ThemeMode;
  defaultColorTheme?: ColorTheme;
  storageKey?: string;
}

/**
 * Synchronizes application theme state with the DOM, system preference, and local storage.
 */
export function ThemeProvider({
  children,
  defaultMode = 'system',
  defaultColorTheme = 'default',
  storageKey = DEFAULT_THEME_STORAGE_KEY,
}: ThemeProviderProps) {
  const [preferences, setPreferences] = useState<ThemePreferences>(() =>
    readStoredPreferences(storageKey, { mode: defaultMode, colorTheme: defaultColorTheme })
  );

  useLayoutEffect(() => {
    applyTheme(preferences);
  }, [preferences]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(preferences));
    } catch {
      // Theme switching remains functional when storage is unavailable.
    }
  }, [preferences, storageKey]);

  useEffect(() => {
    if (preferences.mode !== 'system') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    /**
     * Reapplies the effective mode when the operating-system preference changes.
     */
    function handleSystemThemeChange() {
      applyTheme(preferences);
    }

    mediaQuery.addEventListener('change', handleSystemThemeChange);
    return () => mediaQuery.removeEventListener('change', handleSystemThemeChange);
  }, [preferences]);

  /**
   * Updates only the light/dark preference while preserving the selected palette.
   */
  function setMode(mode: ThemeMode) {
    setPreferences((current) => ({ ...current, mode }));
  }

  /**
   * Updates only the palette while preserving the selected light/dark preference.
   */
  function setColorTheme(colorTheme: ColorTheme) {
    setPreferences((current) => ({ ...current, colorTheme }));
  }

  return (
    <ThemeContext.Provider value={{ ...preferences, setMode, setColorTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
