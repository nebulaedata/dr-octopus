/**
 * @author Codex
 * @description Extends the shared Checkbox with a distinct indeterminate appearance.
 */
import { Checkbox } from '@octopus/ui/components/checkbox';
import { cn } from '@octopus/ui/lib/utils';
import type { ComponentProps } from 'react';

export type CheckboxHalfProps = Omit<ComponentProps<typeof Checkbox>, 'className'> & {
  className?: string;
};

/**
 * Shows a horizontal mark for indeterminate state while preserving Checkbox interactions and semantics.
 */
export function CheckboxHalf({ className, ...props }: CheckboxHalfProps) {
  return (
    <Checkbox
      {...props}
      className={cn(
        'data-indeterminate:border-primary data-indeterminate:bg-primary data-indeterminate:text-primary-foreground dark:data-indeterminate:bg-primary',
        'data-indeterminate:[&>[data-slot=checkbox-indicator]>svg]:hidden',
        "data-indeterminate:[&>[data-slot=checkbox-indicator]]:after:h-0.5 data-indeterminate:[&>[data-slot=checkbox-indicator]]:after:w-2.5 data-indeterminate:[&>[data-slot=checkbox-indicator]]:after:rounded-full data-indeterminate:[&>[data-slot=checkbox-indicator]]:after:bg-current data-indeterminate:[&>[data-slot=checkbox-indicator]]:after:content-['']",
        className
      )}
    />
  );
}
