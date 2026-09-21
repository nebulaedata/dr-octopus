/**
 * @author root
 * @description Provides the shared lazy Monaco editor used for editable Workspace files and read-only attachment previews.
 */

import { lazy, Suspense, useEffect, useState } from 'react';
import { Spinner } from '@octopus/ui/components/spinner';
import { useTheme } from '@octopus/ui/hooks/use-theme';
import { cn } from '@octopus/ui/lib/utils';
import { useI18n } from '@/i18n/use-i18n';
import type { EditorProps } from '@monaco-editor/react';

const MonacoEditor = lazy(async () => {
  const module = await import('@monaco-editor/react');
  return { default: module.default };
});

export interface CodeEditorProps {
  className?: string;
  language?: string;
  options?: EditorProps['options'];
  path?: string;
  readOnly?: boolean;
  value: string;
  /**
   * Receives complete editable buffer changes; read-only editors never invoke it.
   */
  onChange?(value: string): void;
}

/**
 * Loads Monaco on demand, follows the application theme, and enforces the requested editability contract.
 */
export function CodeEditor({
  className,
  language,
  onChange,
  options,
  path,
  readOnly = false,
  value,
}: CodeEditorProps) {
  const { mode } = useTheme();
  const { t } = useI18n();
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  const editorTheme = mode === 'dark' || (mode === 'system' && systemPrefersDark) ? 'vs-dark' : 'light';

  useEffect(() => {
    if (mode !== 'system') {
      return;
    }
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    /**
     * Keeps every shared Monaco surface synchronized with operating-system theme changes.
     */
    function handleSystemThemeChange(event: MediaQueryListEvent) {
      setSystemPrefersDark(event.matches);
    }

    mediaQuery.addEventListener('change', handleSystemThemeChange);
    return () => mediaQuery.removeEventListener('change', handleSystemThemeChange);
  }, [mode]);

  const editorOptions: EditorProps['options'] = {
    automaticLayout: true,
    minimap: { enabled: true },
    scrollBeyondLastLine: false,
    tabSize: 2,
    ...options,
    ariaLabel:
      options?.ariaLabel ??
      (readOnly
        ? t('components.codeEditor.ariaPreview', 'Code preview')
        : t('components.codeEditor.ariaEdit', 'Code editor')),
    domReadOnly: readOnly,
    readOnly,
  };

  return (
    <div className={cn('h-full min-h-0 min-w-0', className)}>
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
            <Spinner />
            {t('components.codeEditor.loading', 'Loading editor…')}
          </div>
        }
      >
        <MonacoEditor
          height="100%"
          language={language}
          options={editorOptions}
          path={path}
          theme={editorTheme}
          value={value}
          onChange={readOnly || onChange === undefined ? undefined : (next) => onChange(next ?? '')}
        />
      </Suspense>
    </div>
  );
}
