/**
 * @author Codex
 * @description Presents a reusable metric card with an optional icon, label, value, and slot overrides.
 */
import { Card } from '@octopus/ui/components/card';
import { cn } from '@octopus/ui/lib/utils';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export interface StatCardProps {
  icon?: LucideIcon;
  title: ReactNode;
  value: ReactNode;
  classNames?: {
    container?: string;
    value?: string;
  };
}

/**
 * Renders a compact tinted card; callers own data formatting and may override container or value styles.
 */
export function StatCard({ icon: Icon, title, value, classNames }: StatCardProps) {
  return (
    <Card
      className={cn(
        'min-w-0 gap-2 rounded-lg border border-primary/50 bg-primary/5 p-3 ring-0',
        classNames?.container
      )}
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        {Icon ? <Icon className="size-4 shrink-0" aria-hidden="true" /> : null}
        {title}
      </div>
      <div className={cn('font-medium', classNames?.value)}>{value}</div>
    </Card>
  );
}
