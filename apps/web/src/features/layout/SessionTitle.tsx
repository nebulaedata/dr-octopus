/**
 * @author Codex
 * @description Measures overflowing session titles for a hover-only, reversible marquee.
 */
import { useRef } from 'react';
import { useSize } from 'ahooks';
import type { CSSProperties } from 'react';

/**
 * Keeps short titles still and leaves room beneath the overlaid actions at the far endpoint.
 */
export function SessionTitle({ title }: { title: string }) {
  const viewport = useRef<HTMLSpanElement>(null);
  const content = useRef<HTMLSpanElement>(null);
  const viewportSize = useSize(viewport);
  const contentSize = useSize(content);
  const overflow = (contentSize?.width ?? 0) - (viewportSize?.width ?? 0);
  const distance = Math.max(0, overflow) + 72;
  const style = {
    '--title-travel': `${-distance}px`,
    '--title-duration': `${Math.max(4, (distance / 30) * 2)}s`,
  } as CSSProperties;

  return (
    <span
      ref={viewport}
      className="group/title relative min-w-0 truncate font-medium text-sm motion-safe:group-hover:data-[overflow=true]:text-clip"
      data-overflow={overflow > 1}
      style={style}
    >
      <span className="motion-safe:group-hover:group-data-[overflow=true]/title:opacity-0">{title}</span>
      <span
        ref={content}
        aria-hidden="true"
        className="invisible absolute top-0 left-0 w-max whitespace-nowrap align-top motion-safe:group-hover:group-data-[overflow=true]/title:visible motion-safe:group-hover:group-data-[overflow=true]/title:animate-session-title"
      >
        {title}
      </span>
    </span>
  );
}
