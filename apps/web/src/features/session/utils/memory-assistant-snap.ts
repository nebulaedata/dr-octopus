/**
 * @author Codex
 * @description Pure geometry that snaps the floating Memory Assistant to the nearest browser viewport edge.
 */

import type { MemoryAssistantPosition, MemoryAssistantViewport } from '@/stores/memory-assistant';

export type { MemoryAssistantPosition, MemoryAssistantViewport } from '@/stores/memory-assistant';

export type MemoryAssistantSnapEdge = 'left' | 'right' | 'top' | 'bottom';

export interface MemoryAssistantSize {
  /** Assistant width in CSS pixels. */
  width: number;
  /** Assistant height in CSS pixels. */
  height: number;
}

/** Default gap kept between the assistant and the viewport edge when snapped. */
export const MEMORY_ASSISTANT_SNAP_MARGIN = 12;

/**
 * Restricts one axis so the whole assistant stays reachable inside the viewport.
 *
 * @param value Coordinate or length on the axis.
 * @param lower Inclusive lower bound, usually the snap margin.
 * @param upper Inclusive upper bound; values below `lower` collapse to `lower`.
 * @returns The nearest in-bounds value.
 */
function clampAxis(value: number, lower: number, upper: number): number {
  if (upper < lower) {
    return lower;
  }
  return Math.min(upper, Math.max(lower, value));
}

/**
 * Keeps the assistant fully visible by clamping its top-left corner into the viewport.
 *
 * @param position Requested top-left corner.
 * @param size Assistant dimensions.
 * @param viewport Browser viewport dimensions.
 * @param margin Minimum gap from each viewport edge; defaults to {@link MEMORY_ASSISTANT_SNAP_MARGIN}.
 * @returns The closest position where the whole assistant remains reachable.
 */
export function clampMemoryAssistantPosition(
  position: MemoryAssistantPosition,
  size: MemoryAssistantSize,
  viewport: MemoryAssistantViewport,
  margin: number = MEMORY_ASSISTANT_SNAP_MARGIN
): MemoryAssistantPosition {
  return {
    x: clampAxis(position.x, margin, viewport.width - size.width - margin),
    y: clampAxis(position.y, margin, viewport.height - size.height - margin),
  };
}

/**
 * Finds the closest viewport edge and the exact resting position beside it.
 *
 * @param rect Current assistant rectangle; `x`/`y` are the top-left corner.
 * @param viewport Browser viewport dimensions.
 * @param margin Gap kept from the chosen edge; defaults to {@link MEMORY_ASSISTANT_SNAP_MARGIN}.
 * @returns The snapped position and the winning edge; ties prefer horizontal edges.
 */
export function computeMemoryAssistantSnapTarget(
  rect: MemoryAssistantPosition & MemoryAssistantSize,
  viewport: MemoryAssistantViewport,
  margin: number = MEMORY_ASSISTANT_SNAP_MARGIN
): MemoryAssistantPosition & { edge: MemoryAssistantSnapEdge } {
  const candidates: Array<(MemoryAssistantPosition & { edge: MemoryAssistantSnapEdge }) & { cost: number }> =
    [
      { edge: 'left', x: margin, y: rect.y, cost: Math.abs(rect.x - margin) },
      {
        edge: 'right',
        x: viewport.width - rect.width - margin,
        y: rect.y,
        cost: Math.abs(viewport.width - rect.width - margin - rect.x),
      },
      { edge: 'top', x: rect.x, y: margin, cost: Math.abs(rect.y - margin) },
      {
        edge: 'bottom',
        x: rect.x,
        y: viewport.height - rect.height - margin,
        cost: Math.abs(viewport.height - rect.height - margin - rect.y),
      },
    ];
  const winner = candidates.reduce((best, candidate) => (candidate.cost < best.cost ? candidate : best));
  const resting = clampMemoryAssistantPosition(winner, rect, viewport, margin);
  return { x: resting.x, y: resting.y, edge: winner.edge };
}
