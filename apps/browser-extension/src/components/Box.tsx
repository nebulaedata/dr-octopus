/**
 * @author Codex
 * @description Applies consistent popup-region spacing inside layout and scroll boundaries without visual decoration.
 */
import type { ComponentProps } from 'react';
import { cn } from '@octopus/ui/lib/utils';

/**
 * Gives each region its own padding; callers may refine vertical spacing without padding the outer shell.
 */
export function Box({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('p-4', className)} {...props} />;
}
