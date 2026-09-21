/**
 * @author Codex
 * @description Persists the Memory Assistant's resting place with corruption-tolerant browser storage.
 */

export interface MemoryAssistantPosition {
  /** Distance from the viewport's left edge in CSS pixels. */
  x: number;
  /** Distance from the viewport's top edge in CSS pixels. */
  y: number;
}

export interface MemoryAssistantViewport {
  /** Viewport width in CSS pixels. */
  width: number;
  /** Viewport height in CSS pixels. */
  height: number;
}

const STORAGE_KEY = 'dr-octopus.memory-assistant.position.v1';

/**
 * Reads the persisted resting place without letting corrupt data break startup.
 *
 * @returns The stored top-left corner, or null when missing or malformed.
 */
export function readStoredAssistantPosition(): MemoryAssistantPosition | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('x' in parsed) ||
      !('y' in parsed) ||
      typeof parsed.x !== 'number' ||
      typeof parsed.y !== 'number' ||
      !Number.isFinite(parsed.x) ||
      !Number.isFinite(parsed.y)
    ) {
      return null;
    }
    return { x: parsed.x, y: parsed.y };
  } catch {
    return null;
  }
}

/**
 * Persists the resting place, tolerating private-mode storage failures.
 *
 * @param position Top-left corner to remember.
 */
export function writeStoredAssistantPosition(position: MemoryAssistantPosition): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
  } catch {
    // Placement persistence is best-effort; dragging keeps working without it.
  }
}

/**
 * Picks the initial corner: stored placement when present, otherwise beside the right edge above the composer.
 *
 * @param viewport Browser viewport dimensions at first render.
 * @returns A first-guess top-left corner refined after mount with real measurements.
 */
export function initialAssistantPosition(viewport: MemoryAssistantViewport): MemoryAssistantPosition {
  const stored = readStoredAssistantPosition();
  if (stored) {
    return stored;
  }
  return { x: viewport.width - 220, y: viewport.height - 240 };
}
