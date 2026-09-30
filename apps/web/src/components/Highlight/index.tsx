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
const MAX_HIGHLIGHT_CHARACTERS = 100_000;

export interface HighlightProps extends Omit<ComponentProps<'pre'>, 'children'> {
  children: string;
  language?: HighlightLanguage;
  highlight?: boolean;
}

/**
 * Defers highlight.js and its language grammars until highlighted code is rendered.
 */
export function Highlight({
  children,
  className,
  language = 'plaintext',
  highlight = true,
  ...props
}: HighlightProps) {
  const fallback = (
    <pre className={cn('max-w-full overflow-auto rounded-lg text-xs', className)} {...props}>
      <code className="block min-w-full w-fit p-3" data-language={language}>
        {children}
      </code>
    </pre>
  );

  // Plain logs, streaming text and large payloads retain all source text without loading or running grammars.
  if (!highlight || language === 'plaintext' || children.length > MAX_HIGHLIGHT_CHARACTERS) {
    return fallback;
  }

  return (
    <Suspense fallback={fallback}>
      <LazyHighlightRenderer className={className} language={language} {...props}>
        {children}
      </LazyHighlightRenderer>
    </Suspense>
  );
}
