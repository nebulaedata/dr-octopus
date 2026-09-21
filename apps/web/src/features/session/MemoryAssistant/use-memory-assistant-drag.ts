/**
 * @author Codex
 * @description Owns pointer and keyboard repositioning, edge snapping, and persisted placement of the floating Memory Assistant.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  initialAssistantPosition,
  readStoredAssistantPosition,
  writeStoredAssistantPosition,
} from '@/stores/memory-assistant';
import { clampMemoryAssistantPosition, computeMemoryAssistantSnapTarget } from './memory-assistant-snap';
import { createMemoryAssistantSpring } from './memory-assistant-spring';
import type { MemoryAssistantSpring } from './memory-assistant-spring';
import type { MemoryAssistantPosition, MemoryAssistantViewport } from '@/stores/memory-assistant';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react';

const DRAG_THRESHOLD_PX = 6;
const KEYBOARD_NUDGE_PX = 24;

/**
 * Measures the live viewport without assuming fixed layout sizes.
 */
function readViewport(): MemoryAssistantViewport {
  return { width: window.innerWidth, height: window.innerHeight };
}

interface ActiveGesture {
  pointerId: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  dragging: boolean;
}

export interface MemoryAssistantDrag {
  /** Element receiving the fixed positioning and pointer handlers. */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Current top-left corner in CSS pixels; updates every animation frame while snapping. */
  position: MemoryAssistantPosition;
  /** True between the drag threshold and pointer release, driving cursor and lift styles. */
  dragging: boolean;
  /** Starts a potential drag; promotes to a real drag once the pointer passes the threshold. */
  handlePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  /** Swallows the click synthesized right after a drag so the avatar splash and bubble link do not fire. */
  handleClickCapture: (event: ReactMouseEvent<HTMLDivElement>) => void;
  /** Moves the assistant with arrow keys for keyboard and switch users. */
  handleKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}

/**
 * Binds gestures to the assistant: drag or nudge freely, then spring onto the nearest viewport edge and remember it.
 */
export function useMemoryAssistantDrag(): MemoryAssistantDrag {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<MemoryAssistantPosition>(() =>
    initialAssistantPosition(readViewport())
  );
  const [dragging, setDragging] = useState(false);
  const positionRef = useRef(position);
  const suppressClickRef = useRef(false);
  const gestureRef = useRef<ActiveGesture | null>(null);
  const teardownGestureRef = useRef<(() => void) | null>(null);

  /**
   * Writes through to both the render state and the mutable frame-loop copy.
   *
   * @param next New top-left corner.
   */
  const applyPosition = useCallback((next: MemoryAssistantPosition) => {
    positionRef.current = next;
    setPosition(next);
  }, []);

  const springRef = useRef<MemoryAssistantSpring | null>(null);

  /**
   * Creates the spring after mount so its ref-reading callbacks live outside render, and disposes it on unmount.
   */
  useEffect(() => {
    const spring = createMemoryAssistantSpring(
      () => positionRef.current,
      applyPosition,
      (resting) => writeStoredAssistantPosition(resting)
    );
    springRef.current = spring;
    return () => {
      spring.dispose();
      springRef.current = null;
    };
  }, [applyPosition]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0 || gestureRef.current) {
        return;
      }
      const container = containerRef.current;
      if (!container) {
        return;
      }
      const rect = container.getBoundingClientRect();
      suppressClickRef.current = false;
      springRef.current?.cancel();
      const gesture: ActiveGesture = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        dragging: false,
      };
      gestureRef.current = gesture;

      /**
       * Follows the pointer once the threshold is crossed, clamping so the assistant never leaves the viewport.
       *
       * @param moveEvent Active pointer sample from the window-level listener.
       */
      const handleMove = (moveEvent: PointerEvent): void => {
        if (gestureRef.current !== gesture || moveEvent.pointerId !== gesture.pointerId) {
          return;
        }
        if (!gesture.dragging) {
          const travel = Math.hypot(moveEvent.clientX - gesture.startX, moveEvent.clientY - gesture.startY);
          if (travel < DRAG_THRESHOLD_PX) {
            return;
          }
          gesture.dragging = true;
          suppressClickRef.current = true;
          setDragging(true);
          try {
            container.setPointerCapture(gesture.pointerId);
          } catch {
            // Synthetic or already-released pointers cannot be captured; window listeners still track them.
          }
        }
        moveEvent.preventDefault();
        const live = container.getBoundingClientRect();
        const next = clampMemoryAssistantPosition(
          { x: moveEvent.clientX - gesture.offsetX, y: moveEvent.clientY - gesture.offsetY },
          live,
          readViewport()
        );
        applyPosition(next);
      };

      /**
       * Shared teardown: only the live gesture reacts, and only a real drag releases or snaps.
       *
       * @param endEvent Final sample for this gesture.
       * @param canceled Whether the platform canceled the gesture instead of a button release.
       */
      const finishGesture = (endEvent: PointerEvent, canceled: boolean): void => {
        if (gestureRef.current !== gesture || endEvent.pointerId !== gesture.pointerId) {
          return;
        }
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        window.removeEventListener('pointercancel', handleCancel);
        teardownGestureRef.current = null;
        gestureRef.current = null;
        if (!gesture.dragging) {
          return;
        }
        suppressClickRef.current = !canceled && suppressClickRef.current;
        setDragging(false);
        try {
          if (container.hasPointerCapture(gesture.pointerId)) {
            container.releasePointerCapture(gesture.pointerId);
          }
        } catch {
          // Capture may never have been established; releasing is best-effort.
        }
        if (canceled) {
          return;
        }
        const live = container.getBoundingClientRect();
        const target = computeMemoryAssistantSnapTarget(
          { ...positionRef.current, width: live.width, height: live.height },
          readViewport()
        );
        springRef.current?.start(target, live);
      };

      /**
       * Ends the gesture after a genuine left-button release and springs onto the nearest edge.
       *
       * @param upEvent Final pointer sample for this gesture.
       */
      const handleUp = (upEvent: PointerEvent): void => {
        if (upEvent.button !== 0) {
          return;
        }
        finishGesture(upEvent, false);
      };

      /**
       * Aborts the gesture on platform cancel (native drag, touch takeover) without synthesizing a click.
       *
       * @param cancelEvent Canceling pointer sample for this gesture.
       */
      const handleCancel = (cancelEvent: PointerEvent): void => {
        finishGesture(cancelEvent, true);
      };

      teardownGestureRef.current = () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        window.removeEventListener('pointercancel', handleCancel);
        teardownGestureRef.current = null;
      };
      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
      window.addEventListener('pointercancel', handleCancel);
    },
    [applyPosition]
  );

  const handleClickCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>): void => {
    if (!suppressClickRef.current) {
      return;
    }
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      const deltaByKey: Record<string, MemoryAssistantPosition> = {
        ArrowLeft: { x: -KEYBOARD_NUDGE_PX, y: 0 },
        ArrowRight: { x: KEYBOARD_NUDGE_PX, y: 0 },
        ArrowUp: { x: 0, y: -KEYBOARD_NUDGE_PX },
        ArrowDown: { x: 0, y: KEYBOARD_NUDGE_PX },
      };
      const delta = deltaByKey[event.key];
      const container = containerRef.current;
      if (!delta || !container) {
        return;
      }
      event.preventDefault();
      springRef.current?.cancel();
      const live = container.getBoundingClientRect();
      const next = clampMemoryAssistantPosition(
        { x: positionRef.current.x + delta.x, y: positionRef.current.y + delta.y },
        live,
        readViewport()
      );
      applyPosition(next);
      writeStoredAssistantPosition(next);
    },
    [applyPosition]
  );

  /**
   * Re-measures once after mount so the first resting place uses real element dimensions instead of estimates.
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const rect = container.getBoundingClientRect();
    const stored = readStoredAssistantPosition();
    const next = stored
      ? clampMemoryAssistantPosition(stored, rect, readViewport())
      : computeMemoryAssistantSnapTarget(rect, readViewport());
    applyPosition(next);
  }, [applyPosition]);

  /**
   * Keeps the assistant reachable when the viewport changes or the bubble content resizes it.
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const reclamp = (): void => {
      springRef.current?.cancel();
      const live = container.getBoundingClientRect();
      applyPosition(clampMemoryAssistantPosition(positionRef.current, live, readViewport()));
    };
    const observer = new ResizeObserver(reclamp);
    observer.observe(container);
    window.addEventListener('resize', reclamp);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', reclamp);
    };
  }, [applyPosition]);

  /**
   * Tears down any in-flight gesture listeners with the component so hidden tabs never leak them.
   */
  useEffect(() => {
    return () => {
      teardownGestureRef.current?.();
    };
  }, []);

  return { containerRef, position, dragging, handlePointerDown, handleClickCapture, handleKeyDown };
}
