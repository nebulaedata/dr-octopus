/**
 * @author Codex
 * @description Drives the Memory Assistant's under-damped spring onto its snapped resting place, clamped to the viewport.
 */
import { clampMemoryAssistantPosition } from './memory-assistant-snap';
import type { MemoryAssistantPosition, MemoryAssistantSize, MemoryAssistantViewport } from './memory-assistant-snap';

const SPRING_STIFFNESS = 0.12;
const SPRING_DAMPING = 0.78;
const SPRING_STOP_DISTANCE = 0.5;
const SPRING_STOP_VELOCITY = 0.5;

/**
 * Reports whether the user asked the platform to minimize non-essential motion.
 */
function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Measures the live viewport without assuming fixed layout sizes.
 */
function readViewport(): MemoryAssistantViewport {
  return { width: window.innerWidth, height: window.innerHeight };
}

export interface MemoryAssistantSpring {
  /**
   * Animates toward the resting corner, or lands instantly when reduced motion is preferred.
   *
   * @param target Snapped top-left corner to settle on.
   * @param size Live assistant dimensions used to keep every frame reachable.
   */
  start: (target: MemoryAssistantPosition, size: MemoryAssistantSize) => void;
  /** Cancels any in-flight animation so a fresh gesture never fights a stale frame. */
  cancel: () => void;
  /** Cancels and releases the animation frame on unmount. */
  dispose: () => void;
}

/**
 * Creates a spring whose frames stay inside the viewport and whose final rest is reported once.
 *
 * @param readPosition Returns the live top-left corner that the previous frame wrote.
 * @param applyPosition Receives every animated corner, including the reduced-motion jump.
 * @param onRest Receives the exact resting corner exactly once per started animation.
 */
export function createMemoryAssistantSpring(
  readPosition: () => MemoryAssistantPosition,
  applyPosition: (position: MemoryAssistantPosition) => void,
  onRest: (resting: MemoryAssistantPosition) => void
): MemoryAssistantSpring {
  let frame: number | null = null;

  const cancel = (): void => {
    if (frame !== null) {
      window.cancelAnimationFrame(frame);
      frame = null;
    }
  };

  const start = (target: MemoryAssistantPosition, size: MemoryAssistantSize): void => {
    cancel();
    if (prefersReducedMotion()) {
      applyPosition(target);
      onRest(target);
      return;
    }
    const resting = { x: target.x, y: target.y };
    const velocity = { x: 0, y: 0 };
    const step = (): void => {
      const current = readPosition();
      velocity.x = (velocity.x + (target.x - current.x) * SPRING_STIFFNESS) * SPRING_DAMPING;
      velocity.y = (velocity.y + (target.y - current.y) * SPRING_STIFFNESS) * SPRING_DAMPING;
      const bounds = readViewport();
      const next = clampMemoryAssistantPosition({ x: current.x + velocity.x, y: current.y + velocity.y }, size, bounds, 0);
      const distance = Math.hypot(target.x - next.x, target.y - next.y);
      const speed = Math.hypot(velocity.x, velocity.y);
      if (distance < SPRING_STOP_DISTANCE && speed < SPRING_STOP_VELOCITY) {
        frame = null;
        applyPosition(resting);
        onRest(resting);
        return;
      }
      applyPosition(next);
      frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
  };

  return { start, cancel, dispose: cancel };
}
