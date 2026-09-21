/**
 * @author Codex
 * @description Defines the shared theme contract, persistence rules, and DOM synchronization utilities.
 */

import { createContext } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ColorTheme = 'default' | 'electric' | 'shadcn';

export interface ThemePreferences {
  mode: ThemeMode;
  colorTheme: ColorTheme;
}

export interface ThemeContextValue extends ThemePreferences {
  setMode: (mode: ThemeMode) => void;
  setColorTheme: (colorTheme: ColorTheme) => void;
}

export const DEFAULT_THEME_STORAGE_KEY = 'octopus-ui-theme-v1';
export const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

/**
 * Checks whether an unknown persisted value is a supported mode.
 */
function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

/**
 * Checks whether an unknown persisted value is a supported color theme.
 */
function isColorTheme(value: unknown): value is ColorTheme {
  return value === 'default' || value === 'electric' || value === 'shadcn';
}

/**
 * Resolves system mode only at the DOM boundary so stored preferences remain stable.
 */
function resolveMode(mode: ThemeMode): Exclude<ThemeMode, 'system'> {
  if (mode !== 'system') {
    return mode;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Applies both theme axes atomically to the root element.
 */
export function applyTheme({ mode, colorTheme }: ThemePreferences) {
  const root = document.documentElement;
  const resolvedMode = resolveMode(mode);

  root.classList.remove('light', 'dark');
  root.classList.add(resolvedMode);
  root.dataset.colorTheme = colorTheme;
  root.style.colorScheme = resolvedMode;
}

/**
 * Reads and validates one versioned local preference record.
 */
export function readStoredPreferences(storageKey: string, defaults: ThemePreferences): ThemePreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Partial<ThemePreferences> | null;

    return {
      mode: isThemeMode(stored?.mode) ? stored.mode : defaults.mode,
      colorTheme: isColorTheme(stored?.colorTheme) ? stored.colorTheme : defaults.colorTheme,
    };
  } catch {
    return defaults;
  }
}
