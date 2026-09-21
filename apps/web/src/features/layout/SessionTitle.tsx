/**
 * @author Codex
 * @description Measures overflowing session titles for a hover-only, reversible marquee.
 */
import { useRef } from 'react';
import { useSize } from 'ahooks';
import styles from './session-title.module.css';
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
      className={`${styles.viewport} min-w-0 truncate font-medium text-sm`}
      data-overflow={overflow > 1}
      style={style}
    >
      <span className={styles.staticTitle}>{title}</span>
      <span ref={content} aria-hidden="true" className={styles.content}>
        {title}
      </span>
    </span>
  );
}
