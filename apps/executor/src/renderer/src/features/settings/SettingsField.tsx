/**
 * @author Codex
 * @description Marks unsaved settings with warning styling while preserving validation errors and control state.
 */
import type { ComponentProps } from 'react';
import { Field } from '@octopus/ui/components/field';
import { cn } from '@octopus/ui/lib/utils';

/**
 * Highlights only changed valid controls without altering their layout or overriding checked switch colors.
 */
export function SettingsField({
  changed,
  invalid = false,
  className,
  ...props
}: ComponentProps<typeof Field> & { changed: boolean; invalid?: boolean }) {
  return (
    <Field
      {...props}
      aria-description={changed ? '此设置有未保存的更改' : undefined}
      data-changed={changed}
      data-invalid={invalid}
      className={cn(
        changed &&
          !invalid && [
            '[&_:is([data-slot=input],[data-slot=select-trigger])]:border-amber-500',
            '[&_:is([data-slot=input],[data-slot=select-trigger])]:bg-amber-50 dark:[&_:is([data-slot=input],[data-slot=select-trigger])]:bg-amber-950/30',
            '[&_[data-slot=switch]]:ring-2 [&_[data-slot=switch]]:ring-amber-500/60',
          ],
        className
      )}
    />
  );
}
