/**
 * @author Codex
 * @description Owns the management page viewport with shadcn-style Base UI scrollbars and CSP-safe native scrollbar suppression.
 */
import type { ReactNode } from 'react';
import { ScrollArea } from '@base-ui/react/scroll-area';
import { CSPProvider } from '@base-ui/react/csp-provider';

/**
 * Keeps navigation outside the scrollable main landmark and mounts a vertical scrollbar only for overflowing content.
 */
export function ExecutorScrollArea({ children }: { children: ReactNode }) {
  return (
    <CSPProvider disableStyleElements>
      <ScrollArea.Root render={<main />} data-slot="scroll-area" className="relative min-h-0 flex-1">
        <ScrollArea.Viewport
          data-slot="scroll-area-viewport"
          className="size-full [scrollbar-width:none] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-scrollbar]:hidden"
        >
          {children}
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar
          data-slot="scroll-area-scrollbar"
          orientation="vertical"
          className="flex h-full w-2.5 touch-none border-l border-l-transparent p-px select-none"
        >
          <ScrollArea.Thumb
            data-slot="scroll-area-thumb"
            className="relative flex-1 rounded-full bg-border"
          />
        </ScrollArea.Scrollbar>
      </ScrollArea.Root>
    </CSPProvider>
  );
}
