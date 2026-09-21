/**
 * @author Codex
 * @description Renders local deterministic pixel artwork beside a subagent's visible name.
 */

import { createSubagentAvatar } from './subagent-avatar';

/**
 * Displays decorative identity artwork without network requests or mutable random state.
 */
export function SubagentAvatar({ seed, size = 28 }: { seed: string; size?: number }) {
  const { foreground, background, pixels } = createSubagentAvatar(seed);
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 7 7"
      shapeRendering="crispEdges"
      className="shrink-0 overflow-hidden rounded-md"
    >
      <rect width="7" height="7" fill={background} />
      <g fill={foreground}>
        {pixels.map(({ x, y }) => (
          <rect key={`${x}:${y}`} x={x} y={y} width="1" height="1" />
        ))}
      </g>
    </svg>
  );
}
