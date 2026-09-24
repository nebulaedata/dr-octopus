/**
 * @author Codex
 * @description 依据当前主题模式在 github-markdown-css 浅色/深色样式表间切换
 */

import { useEffect, useState } from 'react';
import { useTheme } from '@octopus/ui/hooks/use-theme';
import githubMarkdownDarkHref from 'github-markdown-css/github-markdown-dark.css?url';
import githubMarkdownLightHref from 'github-markdown-css/github-markdown-light.css?url';

const STYLE_ELEMENT_ID = 'github-markdown-theme-stylesheet';

/**
 * 解析当前生效的浅色/深色配色，`system` 模式下跟随操作系统偏好实时更新。
 */
function useResolvedColorScheme() {
  const { mode } = useTheme();
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  useEffect(() => {
    if (mode !== 'system') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    /**
     * 同步系统深色模式偏好的实时变化。
     */
    function handleSystemPreferenceChange(event: MediaQueryListEvent) {
      setSystemPrefersDark(event.matches);
    }

    mediaQuery.addEventListener('change', handleSystemPreferenceChange);
    return () => mediaQuery.removeEventListener('change', handleSystemPreferenceChange);
  }, [mode]);

  if (mode !== 'system') {
    return mode;
  }
  return systemPrefersDark ? 'dark' : 'light';
}

/**
 * 无渲染输出的主题挂载组件，通过单个受控 `<link>` 元素加载对应的 github-markdown-css 样式表，
 * 避免浅色/深色样式同时生效造成的选择器冲突。
 */
export function MarkdownRenderTheme() {
  const resolvedScheme = useResolvedColorScheme();

  useEffect(() => {
    let link = document.getElementById(STYLE_ELEMENT_ID) as HTMLLinkElement | null;
    if (link === null) {
      link = document.createElement('link');
      link.id = STYLE_ELEMENT_ID;
      link.rel = 'stylesheet';
      document.head.append(link);
    }
    link.href = resolvedScheme === 'dark' ? githubMarkdownDarkHref : githubMarkdownLightHref;
  }, [resolvedScheme]);

  return null;
}
