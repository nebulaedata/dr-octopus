/**
 * @author Codex
 * @description Theme-aware code surface with one bounded shadcn scroll viewport and slotted syntax rendering.
 */
import { ScrollArea } from '@octopus/ui/components/scroll-area';
import { cn } from '@octopus/ui/lib/utils';
import * as React from 'react';

export interface CodeBlockProps {
  children: React.ReactNode;
  maxHeight?: number;
  className?: string;
  'aria-label'?: string;
}

/**
 * Wraps a pre/code renderer without owning its language, text or business data.
 * Short content uses its natural height; longer content scrolls at the supplied pixel limit.
 * Lines wrap, including unbroken tokens, so only the ScrollArea viewport owns overflow.
 * At either vertical boundary, scrolling continues naturally in the enclosing transcript.
 */
export function CodeBlock({
  children,
  maxHeight = 384,
  className,
  'aria-label': label = 'Code block',
}: CodeBlockProps) {
  return (
    <ScrollArea
      role="region"
      aria-label={label}
      data-code-block=""
      style={{ '--code-block-max-height': `${maxHeight}px` } as React.CSSProperties}
      className={cn(
        'min-w-0 w-full rounded-lg bg-muted text-foreground',
        '[&>[data-slot=scroll-area-viewport]]:h-auto [&>[data-slot=scroll-area-viewport]]:max-h-(--code-block-max-height) [&>[data-slot=scroll-area-viewport]]:overscroll-y-auto',
        '[&_pre]:m-0 [&_pre]:max-h-none [&_pre]:max-w-full [&_pre]:overflow-visible [&_pre]:rounded-none [&_pre]:bg-transparent [&_pre]:font-mono [&_pre]:text-xs [&_pre]:leading-relaxed',
        '[&_pre>code]:block! [&_pre>code]:w-full! [&_pre>code]:min-w-0! [&_pre>code]:overflow-visible! [&_pre>code]:bg-transparent! [&_pre>code]:p-3! [&_pre>code]:text-inherit! [&_pre>code]:whitespace-pre-wrap! [&_pre>code]:wrap-anywhere!',
        className
      )}
    >
      {children}
    </ScrollArea>
  );
}
