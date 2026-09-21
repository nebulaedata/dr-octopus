/**
 * @author Codex
 * @description Draws SVG water ripples synchronized with the mascot and transient bubbles on activation.
 */

interface OctopusWaterEffectsProps {
  /** Absolute SVG timeline start for a splash; null keeps the bubbles hidden. */
  reactionStart: number | null;
  /** Duration in seconds shared with the mascot bounce so bubbles finish before cleanup. */
  reactionDuration: number;
}

const bubbles = [
  { x: 27, y: 110, radius: 3.4, drift: -7, rise: -28, delay: 0.12 },
  { x: 99, y: 108, radius: 4.2, drift: 8, rise: -34, delay: 0.25 },
  { x: 88, y: 114, radius: 2.6, drift: 3, rise: -22, delay: 0.38 },
];

/**
 * Adds decorative water motion without intercepting pointer input or introducing CSS animations.
 */
export function OctopusWaterEffects({ reactionStart, reactionDuration }: OctopusWaterEffectsProps) {
  const timeScale = reactionDuration / 1.6;

  return (
    <g aria-hidden="true" pointerEvents="none" fill="none" stroke="#38bdf8" strokeWidth="1">
      {[29, 99].map((x) => (
        <ellipse key={x} cx={x} cy="114" rx="5" ry="1.5" opacity="0">
          <animate
            attributeName="rx"
            values="5;18;18"
            keyTimes="0;0.24;1"
            dur="8s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="ry"
            values="1.5;4.5;4.5"
            keyTimes="0;0.24;1"
            dur="8s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            values="0;0.45;0;0"
            keyTimes="0;0.025;0.24;1"
            dur="8s"
            repeatCount="indefinite"
          />
        </ellipse>
      ))}
      {reactionStart !== null &&
        bubbles.map(({ x, y, radius, drift, rise, delay }) => (
          <g key={`${reactionStart}-${x}`} opacity="0">
            <animateTransform
              attributeName="transform"
              type="translate"
              from="0 0"
              to={`${drift} ${rise}`}
              begin={`${reactionStart + delay * timeScale}s`}
              dur={`${1.1 * timeScale}s`}
              fill="freeze"
            />
            <animate
              attributeName="opacity"
              values="0;0.8;0.65;0"
              keyTimes="0;0.15;0.7;1"
              begin={`${reactionStart + delay * timeScale}s`}
              dur={`${1.1 * timeScale}s`}
              fill="freeze"
            />
            <circle cx={x} cy={y} r={radius} fill="#e0f2fe" fillOpacity="0.55" />
            <circle cx={x - radius * 0.3} cy={y - radius * 0.3} r="0.75" fill="white" stroke="none" />
          </g>
        ))}
    </g>
  );
}
