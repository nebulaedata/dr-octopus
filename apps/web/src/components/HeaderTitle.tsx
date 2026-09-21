/**
 * @author Codex
 * @description Presents a shared header title and description without depending on page or business data.
 */

import { cn } from '@octopus/ui/lib/utils';
import type { ReactNode } from 'react';

export interface HeaderTitleProps {
  title: ReactNode;
  description: ReactNode;
  truncateDescription?: boolean;
}

/**
 * Keeps header typography consistent, with optional single-line description truncation.
 */
export function HeaderTitle({ title, description, truncateDescription = true }: HeaderTitleProps) {
  return (
    <div className="min-w-0 flex-1">
      <h1 className="truncate text-sm font-semibold">{title}</h1>
      <p className={cn('text-xs text-muted-foreground', truncateDescription && 'truncate')}>{description}</p>
    </div>
  );
}
