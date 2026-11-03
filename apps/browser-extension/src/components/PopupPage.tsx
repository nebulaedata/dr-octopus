/**
 * @author Codex
 * @description Keeps popup navigation and actions fixed while one shared ScrollArea owns body scrolling.
 */
import { useCallback, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Separator } from '@octopus/ui/components/separator';
import { ScrollArea } from '@octopus/ui/components/scroll-area';
import { cn } from '@octopus/ui/lib/utils';
import { Box } from './Box';

/**
 * Composes a bounded feature page and restores its actual viewport after a retained page becomes visible.
 */
export function PopupPage({
  children,
  header,
  footer,
  scrollLabel,
  visible = true,
  scrollKey = '',
  contentClassName,
  scrollViewport,
}: {
  children: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  scrollLabel: string;
  visible?: boolean;
  scrollKey?: string;
  contentClassName?: string;
  scrollViewport?: ReactNode;
}) {
  const viewport = useRef<HTMLDivElement | null>(null);
  const position = useRef(0);
  const previousKey = useRef(scrollKey);

  /**
   * Resolves the shared component's documented viewport slot without modifying its implementation.
   */
  const attach = useCallback((root: HTMLDivElement | null) => {
    viewport.current = root?.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]') ?? null;
  }, []);

  useLayoutEffect(() => {
    if (previousKey.current !== scrollKey) {
      previousKey.current = scrollKey;
      position.current = 0;
    }
    if (visible && viewport.current) {
      viewport.current.scrollTop = position.current;
    }
  }, [scrollKey, visible]);

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {header && <Box className="flex shrink-0 flex-col gap-3 pb-0">{header}</Box>}
      {scrollViewport ?? (
        <ScrollArea
          ref={attach}
          className="min-h-0 flex-1"
          aria-label={scrollLabel}
          onScrollCapture={(event) => {
            if (visible && event.target === viewport.current) {
              position.current = viewport.current.scrollTop;
            }
          }}
        >
          <Box className={cn('flex min-h-full flex-col gap-4', contentClassName)}>{children}</Box>
        </ScrollArea>
      )}
      {footer && (
        <>
          <Separator />
          <Box className="flex shrink-0 flex-col gap-2 pt-3">{footer}</Box>
        </>
      )}
    </section>
  );
}
