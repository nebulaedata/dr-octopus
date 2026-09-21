/**
 * @author Codex
 * @description Loads the official highlight.js GitHub theme matching the application's color mode.
 */

import { useEffect } from 'react';
import { useTheme } from '@octopus/ui/hooks/use-theme';
import githubDarkHref from 'highlight.js/styles/github-dark.css?url';
import githubLightHref from 'highlight.js/styles/github.css?url';

const DARK_STYLE_ELEMENT_ID = 'highlight-js-github-dark-theme';
const LIGHT_STYLE_ELEMENT_ID = 'highlight-js-github-light-theme';

/**
 * Creates or updates one shared highlight.js theme stylesheet.
 */
function mountThemeStylesheet(id: string, href: string, media: string) {
  let link = document.getElementById(id) as HTMLLinkElement | null;
  if (link === null) {
    link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    document.head.append(link);
  }
  link.href = href;
  link.media = media;
}

/**
 * Keeps official light and dark styles aligned with explicit or system theme selection.
 */
export function HighlightTheme() {
  const { mode } = useTheme();

  useEffect(() => {
    const lightMedia =
      mode === 'dark' ? 'not all' : mode === 'light' ? 'all' : '(prefers-color-scheme: light)';
    const darkMedia = mode === 'light' ? 'not all' : mode === 'dark' ? 'all' : '(prefers-color-scheme: dark)';
    mountThemeStylesheet(LIGHT_STYLE_ELEMENT_ID, githubLightHref, lightMedia);
    mountThemeStylesheet(DARK_STYLE_ELEMENT_ID, githubDarkHref, darkMedia);
  }, [mode]);

  return null;
}
