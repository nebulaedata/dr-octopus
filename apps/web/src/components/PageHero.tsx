/**
 * @author Codex
 * @description Presents a consistent page hero with title, description, and actions.
 */

import { cn } from '@octopus/ui/lib/utils';
import type { ReactNode } from 'react';

export interface PageHeroProps {
  title: ReactNode;
  description?: ReactNode;
  extra?: ReactNode;
  className?: string;
}

/**
 * Renders the page hero with a soft gradient wash, keeping the visual weight centered on every page.
 */
export function PageHero({ title, description, extra, className }: PageHeroProps) {
  return (
    <section
      aria-label="hero"
      className={cn(
        'relative shrink-0 overflow-hidden rounded-2xl border bg-card border-primary/15',
        className
      )}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -right-16 -top-28 size-80 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-32 left-1/4 size-72 rounded-full bg-primary/5 blur-3xl" />
        <div
          className="absolute inset-0 mask-[radial-gradient(ellipse_at_top_right,black,transparent_70%)]"
          style={{
            backgroundImage: 'radial-gradient(circle, var(--foreground) 1px, transparent 1.5px)',
            backgroundSize: '22px 22px',
            opacity: 0.05,
          }}
        />
      </div>
      <div className="relative flex flex-wrap items-center justify-between gap-x-10 gap-y-6 p-5">
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold tracking-tight sm:text-lg">{title}</h1>
          {description !== undefined && description !== null && (
            <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted-foreground">{description}</p>
          )}
        </div>
        {extra !== undefined && extra !== null && (
          <div className="flex shrink-0 items-center gap-2">{extra}</div>
        )}
      </div>
    </section>
  );
}
