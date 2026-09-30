/**
 * @author Codex
 * @description Business-agnostic ordered timeline layout with theme-aware rails and density variants.
 */
import { cn } from '@octopus/ui/lib/utils';
import type { ComponentProps, ReactNode } from 'react';

/**
 * Preserves caller ordering as an accessible list without owning event data or disclosure state.
 */
export function Timeline({ className, ...props }: ComponentProps<'ol'>) {
  return <ol className={cn('flex min-w-0 flex-col', className)} {...props} />;
}

/**
 * Connects adjacent nodes, allowing expanded content to determine each segment's height.
 * The final segment ends at its node unless extendLine keeps a rail beside expanded content.
 * Callers own icon semantics and interactive content.
 */
export function TimelineItem({
  icon,
  children,
  density = 'default',
  className,
  iconClassName,
  extendLine = false,
  ...props
}: Omit<ComponentProps<'li'>, 'children'> & {
  icon: ReactNode;
  children: ReactNode;
  density?: 'default' | 'compact';
  iconClassName?: string;
  extendLine?: boolean;
}) {
  const compact = density === 'compact';
  return (
    <li
      {...props}
      className={cn(
        'group/timeline relative grid min-w-0',
        compact
          ? 'grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2 pb-1 last:pb-0'
          : 'grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 pb-6 last:pb-0',
        className
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          'absolute bottom-0 w-px bg-border',
          !extendLine && 'group-last/timeline:hidden',
          compact ? 'left-2.5 top-6' : 'left-3.5 top-7'
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          'relative flex shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground [&>svg]:size-3.5',
          compact ? 'mt-2 size-5' : 'size-7 border',
          iconClassName
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">{children}</div>
    </li>
  );
}
