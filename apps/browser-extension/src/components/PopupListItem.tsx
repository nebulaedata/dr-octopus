/**
 * @author Codex
 * @description Gives interactive popup list rows one compact hit area and consistent focus/hover behavior.
 */
import type { ComponentProps } from 'react';
import { cn } from '@octopus/ui/lib/utils';

/**
 * Keeps row padding independent from page-region padding and reserves an inset keyboard focus outline.
 */
export function PopupListItem({ className, ...props }: ComponentProps<'button'>) {
  return (
    <button
      type="button"
      data-slot="popup-list-item"
      className={cn(
        'group flex min-h-12 w-full cursor-pointer items-center gap-2 rounded-lg p-2 text-left transition-colors hover:bg-muted active:bg-accent focus-visible:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
}
