/**
 * @author root
 * @description Provides an isolated horizontal scroll area with overflow-aware arrow controls, wheel mapping, and an optional fit-content width mode.
 */

import { useEffect, useRef, useState } from 'react';
import { useEventListener } from 'ahooks';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import { ScrollArea } from '@octopus/ui/components/scroll-area';
import { cn } from '@octopus/ui/lib/utils';
import type { ComponentProps } from 'react';

export type HorizontalAreaProps = Omit<ComponentProps<typeof ScrollArea>, 'ref'> & {
  /**
   * When true, the area shrinks to fit its content and only scrolls once the content exceeds the available width.
   */
  fit?: boolean;
};

interface HorizontalScrollState {
  canScrollLeft: boolean;
  canScrollRight: boolean;
  hasOverflow: boolean;
}

const INITIAL_SCROLL_STATE: HorizontalScrollState = {
  canScrollLeft: false,
  canScrollRight: false,
  hasOverflow: false,
};
const SCROLL_EDGE_TOLERANCE = 1;

/**
 * Resolves the private scrollable viewport for either the native fit-content container or the Base UI ScrollArea.
 */
function resolveViewport(
  fit: boolean,
  areaElement: HTMLDivElement | null,
  viewportElement: HTMLDivElement | null
): HTMLElement | undefined {
  if (fit) {
    return viewportElement ?? undefined;
  }
  return areaElement?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]') ?? undefined;
}

/**
 * Renders isolated horizontal overflow behavior and leaves content layout entirely to its caller.
 */
export function HorizontalArea({ children, className, fit = false, ...props }: HorizontalAreaProps) {
  const areaRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState(INITIAL_SCROLL_STATE);

  useEventListener('wheel', handleWheel, {
    target: areaRef,
    passive: false,
  });

  useEffect(() => {
    const viewport = resolveViewport(fit, areaRef.current, viewportRef.current);
    if (viewport === undefined) {
      return;
    }
    const observedViewport = viewport;

    /**
     * Synchronizes arrow availability with native scrolling and responsive content changes.
     */
    function updateScrollState(): void {
      setScrollState(measureScrollState(observedViewport));
    }

    updateScrollState();
    observedViewport.addEventListener('scroll', updateScrollState, { passive: true });
    const resizeObserver = new ResizeObserver(updateScrollState);
    resizeObserver.observe(observedViewport);
    for (const child of observedViewport.children) {
      resizeObserver.observe(child);
    }
    return () => {
      observedViewport.removeEventListener('scroll', updateScrollState);
      resizeObserver.disconnect();
    };
  }, [children, fit]);

  /**
   * Redirects every wheel gesture to the horizontal axis and prevents outer vertical scroll chaining.
   */
  function handleWheel(event: WheelEvent): void {
    const viewport = resolveViewport(fit, areaRef.current, viewportRef.current);
    if (viewport === undefined || (event.deltaX === 0 && event.deltaY === 0)) {
      return;
    }
    event.preventDefault();
    const multiplier =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? viewport.clientWidth
          : 1;
    const rawDelta = Math.abs(event.deltaX) >= Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const maximum = viewport.scrollWidth - viewport.clientWidth;
    viewport.scrollLeft = Math.min(maximum, Math.max(0, viewport.scrollLeft + rawDelta * multiplier));
    setScrollState(measureScrollState(viewport));
  }

  /**
   * Moves by most of the visible width while retaining context from the preceding card.
   */
  function scrollByPage(direction: -1 | 1): void {
    const viewport = resolveViewport(fit, areaRef.current, viewportRef.current);
    if (viewport === undefined) {
      return;
    }
    viewport.scrollBy({
      behavior: 'smooth',
      left: direction * Math.max(160, viewport.clientWidth * 0.8),
    });
  }

  const overflowButtons = scrollState.hasOverflow ? (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute left-1 top-1/2 -mt-4 z-10 disabled:opacity-30"
        aria-label="Scroll left"
        disabled={!scrollState.canScrollLeft}
        onClick={() => scrollByPage(-1)}
      >
        <ChevronLeftIcon data-icon="inline-start" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-1 top-1/2 -mt-4 z-10 disabled:opacity-30"
        aria-label="Scroll right"
        disabled={!scrollState.canScrollRight}
        onClick={() => scrollByPage(1)}
      >
        <ChevronRightIcon data-icon="inline-end" />
      </Button>
    </>
  ) : null;

  return (
    <div
      ref={areaRef}
      className={cn('relative flex min-w-0 items-center', fit ? 'w-fit max-w-full' : 'w-full', className)}
    >
      {overflowButtons}
      {fit ? (
        <div
          ref={viewportRef}
          className={cn(
            'min-w-0 overflow-x-auto overscroll-x-contain scrollbar-none',
            scrollState.hasOverflow && 'px-9'
          )}
          {...(props as ComponentProps<'div'>)}
        >
          {children}
        </div>
      ) : (
        <ScrollArea className={cn('min-w-0 flex-1', scrollState.hasOverflow && 'px-9')} {...props}>
          {children}
        </ScrollArea>
      )}
    </div>
  );
}

/**
 * Measures overflow and edge availability with tolerance for fractional browser scroll positions.
 */
function measureScrollState(viewport: HTMLElement): HorizontalScrollState {
  const maximum = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
  return {
    hasOverflow: maximum > SCROLL_EDGE_TOLERANCE,
    canScrollLeft: viewport.scrollLeft > SCROLL_EDGE_TOLERANCE,
    canScrollRight: viewport.scrollLeft < maximum - SCROLL_EDGE_TOLERANCE,
  };
}
