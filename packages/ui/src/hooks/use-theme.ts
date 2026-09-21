/**
 * @author Codex
 * @description Exposes the active theme contract to components beneath ThemeProvider.
 */

import { useContext } from 'react';
import { ThemeContext } from '@octopus/ui/lib/theme';
import type { ThemeContextValue } from '@octopus/ui/lib/theme';

/**
 * Returns the active theme contract and rejects use outside its provider.
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);

  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }

  return context;
}
