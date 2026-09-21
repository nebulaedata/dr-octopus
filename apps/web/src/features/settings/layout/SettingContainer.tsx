/**
 * @author Codex
 * @description Shares Settings content spacing and full-height split-pane layouts across pages and dialogs.
 */

import { ScrollArea } from '@octopus/ui/components/scroll-area';
import { cn } from '@octopus/ui/lib/utils';
import type { ReactNode } from 'react';

export interface SettingContainerProps {
  children: ReactNode;
  /**
   * Defaults to centered, scrollable content; full preserves the catalog/detail grid and pane-owned scrolling.
   */
  mode?: 'default' | 'full';
  /**
   * Styles the padded inner container in default mode or the split grid in full mode; content styles the centered stack.
   */
  classNames?: {
    container?: string;
    content?: string;
  };
}

/**
 * Keeps page padding inside the scroll viewport so card rings and focus outlines remain within its clipping boundary.
 */
export function SettingContainer({ children, mode = 'default', classNames }: SettingContainerProps) {
  if (mode === 'full') {
    return (
      <div
        className={cn(
          'grid h-full min-h-0 min-w-0 md:grid-cols-[16rem_minmax(0,1fr)]',
          classNames?.container
        )}
      >
        {children}
      </div>
    );
  }

  return (
    <ScrollArea className="h-full min-h-0">
      <div className={cn('min-h-full p-4 md:p-8', classNames?.container)}>
        <div className={cn('mx-auto flex w-full max-w-3xl flex-col gap-6', classNames?.content)}>
          {children}
        </div>
      </div>
    </ScrollArea>
  );
}
