/**
 * @author Codex
 * @description Shares bounded schedule dialogs with fixed chrome and an independently scrolling body.
 */
import { DialogContent } from '@octopus/ui/components/dialog';
import { ScrollArea } from '@octopus/ui/components/scroll-area';
import { cn } from '@octopus/ui/lib/utils';
import type { ComponentProps, ReactNode } from 'react';

/**
 * Keep headers and footers outside the scrolling viewport on short and narrow screens.
 */
export function ScheduleDialogContent({ className, ...props }: ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent
      className={cn(
        'flex h-[min(85dvh,48rem)] flex-col overflow-hidden [&>[data-slot=dialog-header]]:shrink-0 [&>[data-slot=dialog-header]]:pr-8 [&>[data-slot=dialog-footer]]:shrink-0',
        className
      )}
      {...props}
    />
  );
}

/**
 * Allocate remaining dialog height to the accessible shadcn scroll viewport.
 */
export function ScheduleDialogBody({ children }: { children: ReactNode }) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex min-w-0 flex-col gap-4 pr-3">{children}</div>
    </ScrollArea>
  );
}
