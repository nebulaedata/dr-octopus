/**
 * @author Codex
 * @description Provides a consistent right-side panel shell with a title header and close action.
 */

import { PanelRightCloseIcon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import { Separator } from '@octopus/ui/components/separator';
import { cn } from '@octopus/ui/lib/utils';
import { ScrollArea } from '@octopus/ui/components/scroll-area';
import type { ReactNode } from 'react';

export interface SideRightPanelProps {
  className?: string;
  classNames?: {
    root?: string;
    header?: string;
    content?: string;
  };
  title: string;
  children: ReactNode;
  extraHeaderContent?: ReactNode;
  onClose?(): void;
}

/**
 * Renders a standardized right-side panel for the Workbench layout.
 */
export function SideRightPanel({
  title,
  children,
  onClose,
  className,
  classNames,
  extraHeaderContent,
}: SideRightPanelProps) {
  return (
    <aside
      className={cn(
        'hidden min-h-0 h-full flex-col gap-1 overflow-hidden xl:flex',
        className,
        classNames?.root
      )}
    >
      <div
        aria-label="header"
        className={cn(
          'relative flex w-full min-h-17 items-center justify-between px-5 gap-1 overflow-hidden',
          classNames?.header
        )}
      >
        <span className="max-w-32 truncate text-sm font-semibold" title={title}>
          {title}
        </span>
        <div className="flex-1 flex items-center justify-end gap-1 flex-nowrap whitespace-nowrap overflow-hidden">
          {extraHeaderContent}
        </div>
        {onClose && (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Close ${title.toLowerCase()}`}
            onClick={onClose}
          >
            <PanelRightCloseIcon className="size-4" />
          </Button>
        )}
        <Separator className="absolute bottom-0 left-0 w-full" />
      </div>
      <ScrollArea className={cn('flex-1 min-h-0 px-5', classNames?.content)}>{children}</ScrollArea>
    </aside>
  );
}
