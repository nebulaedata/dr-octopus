/**
 * @author Codex
 * @description Animates the original Dr.Octopus artwork with expressive eyes, water interactions, and a prop-controlled loading state using native SVG.
 */
import { useId } from 'react';
import { useOctopusLogoMotion } from './use-octopus-logo-motion';
import { OctopusWaterEffects } from './OctopusWaterEffects';
import { OctopusLoadingEffects } from './OctopusLoadingEffects';
import { cn } from '@octopus/ui/lib/utils';

export interface OctopusLogoProps {
  /** Additional classes applied to the SVG root. */
  className?: string;
  /** Accessible name announced for the mascot. */
  label?: string;
  /**
   * Plays the loading loop instead of hover, typing, and splash reactions; defaults to false.
   */
  loading?: boolean;
}

const ORIGINAL_LOGO_SRC = `${import.meta.env.BASE_URL}logo-256.png`;

/**
 * Displays the mascot with pointer-following eyes and an optional, reduced-motion-aware loading loop.
 */
export function OctopusLogo({ className, label = 'Dr.Octopus', loading = false }: OctopusLogoProps) {
  const waveClipId = useId();
  const {
    logoRef,
    pupilsRef,
    reactionStart,
    reactionDuration,
    reactionAnimationRef,
    isContinuing,
    activateSplash,
    handleKeyDown,
  } = useOctopusLogoMotion(loading);

  const isTyping = reactionDuration < 1;
  const typingKeyTimes = isContinuing
    ? '0;0.08;0.3;0.38;0.62;0.7;0.83;1'
    : '0;0.22;0.39;0.46;0.64;0.7;0.83;1';

  return (
    <svg
      ref={logoRef}
      aria-label={`${label}, ${loading ? 'loading' : 'click to splash'}`}
      aria-busy={loading || undefined}
      className={cn('block outline-0', loading ? 'cursor-progress' : 'cursor-pointer', className)}
      overflow="visible"
      role={loading ? 'img' : 'button'}
      tabIndex={loading ? undefined : 0}
      onClick={activateSplash}
      onKeyDown={handleKeyDown}
      viewBox="0 0 128 128"
    >
      <title>{loading ? `${label}, loading` : label}</title>
      <defs>
        <clipPath id={waveClipId}>
          <ellipse cx="64" cy="113" rx="64" ry="12" />
        </clipPath>
      </defs>
      <ellipse cx="64" cy="113" rx="64" ry="12" fill="#38bdf8" opacity="0.14" />
      <g>
        {!loading && reactionStart !== null && (
          <animateTransform
            key={reactionStart}
            ref={reactionAnimationRef}
            attributeName="transform"
            type="translate"
            values={isTyping ? '0 0;0 5;0 -13;0 -13;0 2;0 4;0 -4;0 0' : '0 0;0 7;0 -9;0 0'}
            keyTimes={isTyping ? typingKeyTimes : '0;0.18;0.48;1'}
            keySplines={
              isTyping
                ? '0.42 0 0.7 1;0.12 0.85 0.22 1;0 0 1 1;0.55 0 1 0.4;0.2 0.7 0.3 1;0.12 0.85 0.22 1;0.5 0 0.8 1'
                : '0.42 0 0.58 1;0.22 0.61 0.36 1;0.42 0 0.58 1'
            }
            calcMode="spline"
            begin={`${reactionStart}s`}
            dur={`${reactionDuration}s`}
          />
        )}
        <g>
          <animateTransform
            attributeName="transform"
            type="translate"
            values={loading ? '0 0;1 -4;0 -7;-1 -3;0 0' : '0 0;5 -8;-2 -14;-6 -5;0 0'}
            keyTimes="0;0.25;0.5;0.75;1"
            keySplines="0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1"
            calcMode="spline"
            dur={loading ? '1.8s' : '8s'}
            repeatCount="indefinite"
          />
          <animateTransform
            attributeName="transform"
            type="rotate"
            additive="sum"
            values={
              loading
                ? '-4 64 83.2;0 64 83.2;4 64 83.2;0 64 83.2;-4 64 83.2'
                : '-3 64 83.2;2 64 83.2;-1 64 83.2;3 64 83.2;-3 64 83.2'
            }
            keyTimes="0;0.25;0.5;0.75;1"
            keySplines="0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1"
            calcMode="spline"
            dur={loading ? '1.8s' : '8s'}
            repeatCount="indefinite"
          />
          <g transform="translate(64 110)">
            <g>
              {!loading && reactionStart !== null && isTyping && (
                <animateTransform
                  key={reactionStart}
                  attributeName="transform"
                  type="scale"
                  values="1 1;1.07 0.91;0.95 1.08;1 1;1.04 0.96;1.08 0.9;0.98 1.03;1 1"
                  keyTimes={typingKeyTimes}
                  keySplines="0.42 0 0.7 1;0.12 0.85 0.22 1;0.42 0 0.58 1;0.55 0 1 0.4;0.2 0.7 0.3 1;0.12 0.85 0.22 1;0.5 0 0.8 1"
                  calcMode="spline"
                  begin={`${reactionStart}s`}
                  dur={`${reactionDuration}s`}
                />
              )}
              <g transform="translate(-64 -110)">
                <image
                  href={ORIGINAL_LOGO_SRC}
                  width="128"
                  height="128"
                  preserveAspectRatio="xMidYMid meet"
                />

                <g fill="#fb472b">
                  <ellipse cx="49.75" cy="46.5" rx="8" ry="8" />
                  <ellipse cx="78" cy="46.5" rx="8" ry="8" />
                </g>
                <g transform="translate(0 46.5)">
                  <g>
                    <animateTransform
                      attributeName="transform"
                      type="scale"
                      values="1 1;1 1;1 0.08;1 1;1 1;1 0.08;1 1;1 1;1 0.08;1 1;1 1;1 0.08;1 1;1 1"
                      keyTimes="0;0.144;0.15;0.157;0.477;0.483;0.49;0.811;0.817;0.824;0.838;0.844;0.851;1"
                      keySplines="0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1"
                      calcMode="spline"
                      dur="12.6s"
                      repeatCount="indefinite"
                    />
                    <g transform="translate(0 -46.5)">
                      <ellipse cx="49.75" cy="46.5" fill="#fff" rx="7" ry="7.3" />
                      <ellipse cx="78" cy="46.5" fill="#fff" rx="7" ry="7.3" />
                      <g ref={pupilsRef}>
                        <circle cx="49.75" cy="46.5" fill="#171717" r="4.7" />
                        <circle cx="78" cy="46.5" fill="#171717" r="4.7" />
                        <circle cx="48.25" cy="44.8" fill="#fff" r="1.4" />
                        <circle cx="76.5" cy="44.8" fill="#fff" r="1.4" />
                      </g>
                    </g>
                  </g>
                </g>
              </g>
            </g>
          </g>
        </g>
      </g>
      <g aria-hidden="true" pointerEvents="none" clipPath={`url(#${waveClipId})`}>
        <path
          d="M-64 111 Q-48 105-32 111T0 111T32 111T64 111T96 111T128 111T160 111T192 111V128H-64Z"
          fill="#38bdf8"
          opacity="0.3"
        >
          <animateTransform
            attributeName="transform"
            type="translate"
            from="0 0"
            to="64 0"
            dur="8s"
            repeatCount="indefinite"
          />
        </path>
        <path
          d="M-64 117 Q-48 111-32 117T0 117T32 117T64 117T96 117T128 117T160 117T192 117V132H-64Z"
          fill="#0ea5e9"
          opacity="0.45"
        >
          <animateTransform
            attributeName="transform"
            type="translate"
            from="64 0"
            to="0 0"
            dur="6s"
            repeatCount="indefinite"
          />
        </path>
      </g>
      <OctopusWaterEffects
        reactionStart={loading ? null : reactionStart}
        reactionDuration={reactionDuration}
      />
      {loading && <OctopusLoadingEffects />}
    </svg>
  );
}
