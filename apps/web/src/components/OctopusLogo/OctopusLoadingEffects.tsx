/**
 * @author Codex
 * @description Indicates loading with staggered bubbles that rise quickly from the waterline and fade away.
 */

const bubbles = [
  { x: 24, y: 111, radius: 3.4, drift: -8, rise: -62, offset: 0 },
  { x: 104, y: 110, radius: 4.2, drift: 7, rise: -72, offset: 0.22 },
  { x: 34, y: 114, radius: 2.6, drift: -10, rise: -56, offset: 0.45 },
  { x: 94, y: 113, radius: 3, drift: 10, rise: -65, offset: 0.67 },
];

/**
 * Shares the parent SVG timeline so reduced motion freezes a visible loading indicator.
 */
export function OctopusLoadingEffects() {
  return (
    <g aria-hidden="true" pointerEvents="none">
      {bubbles.map(({ x, y, radius, drift, rise, offset }) => (
        <g key={x} opacity="0">
          <animateTransform
            attributeName="transform"
            type="translate"
            values={`0 0;${drift} ${rise};${drift} ${rise}`}
            keyTimes="0;0.8;1"
            begin={`-${offset}s`}
            dur="0.9s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            values="0;0.85;0.65;0;0"
            keyTimes="0;0.08;0.5;0.8;1"
            begin={`-${offset}s`}
            dur="0.9s"
            repeatCount="indefinite"
          />
          <circle cx={x} cy={y} r={radius} fill="#e0f2fe" stroke="#0ea5e9" strokeWidth="1.2" />
          <circle cx={x - radius * 0.3} cy={y - radius * 0.3} r="0.9" fill="white" />
        </g>
      ))}
    </g>
  );
}
