/**
 * @author Codex
 * @description Provides a shared page container and centered content layout with per-slot class overrides.
 */

import { cn } from '@octopus/ui/lib/utils';
import type { ReactNode } from 'react';

export interface PageProps {
  children: ReactNode;
  classNames?: {
    container?: string;
    content?: string;
  };
}

/**
 * Wraps page content in the standard scroll container; slot classes override the default layout.
 */
export function Page({ children, classNames }: PageProps) {
  return (
    <div className={cn('h-full overflow-auto', classNames?.container)}>
      <div
        className={cn(
          'mx-auto flex h-full min-h-0 max-w-5xl flex-col gap-5 px-4 py-5 sm:px-5',
          classNames?.content
        )}
      >
        {children}
      </div>
    </div>
  );
}
