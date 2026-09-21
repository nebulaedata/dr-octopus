/**
 * @author Codex
 * @description Exposes a lazy syntax-highlighting component and lightweight filename language detection.
 */

import { lazy, Suspense } from 'react';
import { cn } from '@octopus/ui/lib/utils';
import type { ComponentProps } from 'react';
import type { HighlightLanguage } from './languages';

export type { HighlightLanguage } from './languages';

const LazyHighlightRenderer = lazy(() => import('./HighlightRenderer'));

export interface HighlightProps extends Omit<ComponentProps<'pre'>, 'children'> {
  children: string;
  language?: HighlightLanguage;
}

/**
 * Defers highlight.js and its language grammars until highlighted code is rendered.
 */
export function Highlight({ children, className, language = 'plaintext', ...props }: HighlightProps) {
  const fallback = (
    <pre className={cn('max-w-full overflow-auto rounded-lg text-xs', className)} {...props}>
      <code className="block min-w-full w-fit p-3">{children}</code>
    </pre>
  );

  return (
    <Suspense fallback={fallback}>
      <LazyHighlightRenderer className={className} language={language} {...props}>
        {children}
      </LazyHighlightRenderer>
    </Suspense>
  );
}
