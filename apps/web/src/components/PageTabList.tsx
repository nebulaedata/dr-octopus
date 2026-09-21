/**
 * @author Codex
 * @description Renders a consistent segmented tab list from declarative items, with optional icons and counts.
 */
import { TabsList, TabsTrigger } from '@octopus/ui/components/tabs';
import { cn } from '@octopus/ui/lib/utils';
import type { ComponentProps, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * Describes one tab entry rendered inside the shared list.
 */
export interface PageTabItem {
  value: string;
  label: ReactNode;
  icon?: LucideIcon;
  count?: number;
}

export interface PageTabListProps extends ComponentProps<typeof TabsList> {
  /** Declarative tab entries rendered in order. */
  items: PageTabItem[];
  /** Extra classes applied to every tab trigger, e.g. fixed widths. */
  itemClassName?: string;
}

/**
 * Renders the shared pill-style tab list so every page keeps the same segmented control look.
 */
export function PageTabList({ items, itemClassName, className, ...props }: PageTabListProps) {
  return (
    <TabsList className={cn('h-10 rounded-xl p-1', className)} {...props}>
      {items.map(({ value, label, icon: Icon, count }) => (
        <TabsTrigger
          key={value}
          value={value}
          className={cn('gap-1.5 rounded-lg px-3 data-active:shadow-sm', itemClassName)}
        >
          {Icon && <Icon />}
          {label}
          {count !== undefined && <span className="text-xs font-geist tabular-nums">{count}</span>}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}
