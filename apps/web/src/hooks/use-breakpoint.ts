/**
 * @author Codex
 * @description Provides Tailwind breakpoint matches for responsive component logic.
 */

import { useEffect, useState } from 'react';

/**
 * Matches the Tailwind `xl` breakpoint (1280px) using a media query.
 * Initialises synchronously so the first client render uses the correct value.
 */
export function useIsXl(): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.matchMedia('(min-width: 1280px)').matches;
  });

  useEffect(() => {
    const query = window.matchMedia('(min-width: 1280px)');
    const update = () => setMatches(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return matches;
}
