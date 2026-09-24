/**
 * @author Codex
 * @description Coordinates loading playback, pointer tracking, and transient feedback on the mascot's native SVG timeline.
 */
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

/**
 * Points both pupils toward one viewport coordinate while keeping them inside the eye whites.
 *
 * @param logo SVG mascot defining the pointer coordinate space.
 * @param pupils Eye group receiving the SVG translation.
 * @param clientX Horizontal pointer coordinate in the viewport.
 * @param clientY Vertical pointer coordinate in the viewport.
 */
function pointPupilsAt(logo: SVGSVGElement, pupils: SVGGElement, clientX: number, clientY: number): void {
  const bounds = logo.getBoundingClientRect();
  const deltaX = clientX - (bounds.left + bounds.width / 2);
  const deltaY = clientY - (bounds.top + bounds.height * (46.5 / 128));
  const distance = Math.hypot(deltaX, deltaY);
  const strength = Math.min(1, distance / 160);
  const directionX = distance === 0 ? 0 : deltaX / distance;
  const directionY = distance === 0 ? 0 : deltaY / distance;
  pupils.setAttribute(
    'transform',
    `translate(${directionX * strength * 1.6} ${directionY * strength * 1.5})`
  );
}

/**
 * Owns transient mascot interactions, throttling text feedback and cleaning up listeners and timers.
 *
 * @param loading Keeps playback active on hover and suppresses transient reactions while loading.
 */
export function useOctopusLogoMotion(loading = false) {
  const [reactionStart, setReactionStart] = useState<number | null>(null);
  const [reactionDuration, setReactionDuration] = useState(1.6);
  const logoRef = useRef<SVGSVGElement>(null);
  const mouseHover = useRef(false);
  const pupilsRef = useRef<SVGGElement>(null);
  const reactionAnimationRef = useRef<SVGAnimateTransformElement>(null);
  const rhythm = useRef({ lastInput: -Infinity, consumedInput: -Infinity, interval: 300 });
  const composition = useRef<{
    target: EventTarget | null;
    endedTarget: EventTarget | null;
    endedAt: number;
  }>({
    target: null,
    endedTarget: null,
    endedAt: -Infinity,
  });
  const [isContinuing, setIsContinuing] = useState(false);

  useEffect(() => {
    const logo = logoRef.current;
    if (logo === null) {
      return;
    }

    /**
     * Keeps the original animation regardless of system motion preferences, pausing only idle mouse hover.
     */
    function syncPlayback(): void {
      if (logo === null) {
        return;
      }
      if (loading && reactionStart !== null) {
        setReactionStart(null);
      }
      if (!loading && reactionStart === null && mouseHover.current) {
        logo.pauseAnimations();
      } else {
        logo.unpauseAnimations();
      }
    }

    syncPlayback();
    const animation = reactionAnimationRef.current;

    /**
     * Chooses the next pace only at landing, preserving the current jump's position and velocity.
     */
    function finishReaction(): void {
      if (logo === null) {
        return;
      }
      const input = rhythm.current;
      if (
        reactionDuration < 1 &&
        !loading &&
        input.lastInput > input.consumedInput &&
        performance.now() - input.lastInput < 350
      ) {
        input.consumedInput = input.lastInput;
        setIsContinuing(true);
        /**
         * Selects inputinterval130 in the existing condition order.
         */
        function selectBlinkDuration() {
          if (input.interval < 130) {
            return 0.44 as const;
          } else if (input.interval < 260) {
            return 0.56 as const;
          } else {
            return 0.72 as const;
          }
        }
        setReactionDuration(selectBlinkDuration());
        setReactionStart(logo.getCurrentTime());
      } else {
        setReactionStart(null);
      }
    }

    animation?.addEventListener('endEvent', finishReaction);
    /**
     * Uses actual mouse entry rather than sticky touchscreen :hover matching.
     */
    function handlePointerEnter(event: PointerEvent): void {
      mouseHover.current = event.pointerType === 'mouse';
      syncPlayback();
    }
    /**
     * Clears hover explicitly before resuming, independent of pseudo-class update timing.
     */
    function handlePointerLeave(): void {
      mouseHover.current = false;
      syncPlayback();
    }
    logo.addEventListener('pointerenter', handlePointerEnter);
    logo.addEventListener('pointerleave', handlePointerLeave);
    let frame: number | undefined;
    let pointerX = window.innerWidth / 2;
    let pointerY = window.innerHeight / 2;

    /**
     * Applies the latest pointer sample once per animation frame.
     */
    function renderPupilDirection(): void {
      frame = undefined;
      if (logo !== null && pupilsRef.current !== null) {
        pointPupilsAt(logo, pupilsRef.current, pointerX, pointerY);
      }
    }

    /**
     * Schedules a pupil update without causing a React render.
     */
    function handlePointerMove(event: globalThis.PointerEvent): void {
      pointerX = event.clientX;
      pointerY = event.clientY;
      frame ??= window.requestAnimationFrame(renderPupilDirection);
    }

    /**
     * Observes text and IME activity without modifying editor events, selections, or composition contents.
     */
    function handleTyping(event: Event): void {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const editable =
        target.isContentEditable ||
        (target instanceof HTMLTextAreaElement && !target.readOnly && !target.disabled) ||
        (target instanceof HTMLInputElement &&
          !target.readOnly &&
          !target.disabled &&
          ['text', 'search', 'email', 'url', 'tel', 'number'].includes(target.type));
      if (!editable) {
        return;
      }
      const now = performance.now();
      const ime = composition.current;
      if (event instanceof CompositionEvent && event.type === 'compositionend') {
        ime.target = null;
        ime.endedTarget = target;
        ime.endedAt = now;
        return;
      }
      const composing =
        event instanceof CompositionEvent &&
        (event.type === 'compositionstart' || event.type === 'compositionupdate');
      if (composing) {
        ime.target = target;
        ime.endedTarget = null;
      }
      if (
        event instanceof InputEvent &&
        (ime.target === target || (ime.endedTarget === target && now - ime.endedAt < 80))
      ) {
        return;
      }
      const textEdit =
        event instanceof InputEvent &&
        [
          'insertText',
          'insertCompositionText',
          'insertFromComposition',
          'deleteContentBackward',
          'deleteContentForward',
        ].includes(event.inputType);
      const typingKey =
        event instanceof globalThis.KeyboardEvent &&
        !event.isComposing &&
        ime.target !== target &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.repeat &&
        (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete');
      if (!textEdit && !composing && !typingKey) {
        return;
      }
      if (typingKey) {
        ime.endedTarget = null;
      }
      if (!editable || logo === null || loading || performance.now() - rhythm.current.lastInput < 24) {
        return;
      }
      const gap = now - rhythm.current.lastInput;
      rhythm.current.interval = gap > 700 ? 300 : rhythm.current.interval * 0.4 + gap * 0.6;
      rhythm.current.lastInput = now;
      if (reactionStart === null) {
        rhythm.current.consumedInput = now;
        setIsContinuing(false);
        setReactionDuration(0.72);
        setReactionStart(logo.getCurrentTime());
      }
    }

    let compositionUpdateTimer: number | undefined;

    /**
     * Defers composition updates until a same-task commit can cancel its final candidate update.
     */
    function handleCompositionUpdate(event: Event): void {
      window.clearTimeout(compositionUpdateTimer);
      compositionUpdateTimer = window.setTimeout(() => {
        if (composition.current.target === event.target) {
          handleTyping(event);
        }
      }, 0);
    }

    window.addEventListener('keydown', handleTyping, true);
    window.addEventListener('beforeinput', handleTyping, true);
    window.addEventListener('input', handleTyping, true);
    window.addEventListener('compositionstart', handleTyping, true);
    window.addEventListener('compositionupdate', handleCompositionUpdate, true);
    window.addEventListener('compositionend', handleTyping, true);
    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    return () => {
      window.clearTimeout(compositionUpdateTimer);
      animation?.removeEventListener('endEvent', finishReaction);
      window.removeEventListener('keydown', handleTyping, true);
      window.removeEventListener('beforeinput', handleTyping, true);
      window.removeEventListener('input', handleTyping, true);
      window.removeEventListener('compositionstart', handleTyping, true);
      window.removeEventListener('compositionupdate', handleCompositionUpdate, true);
      window.removeEventListener('compositionend', handleTyping, true);
      logo.removeEventListener('pointerenter', handlePointerEnter);
      logo.removeEventListener('pointerleave', handlePointerLeave);
      window.removeEventListener('pointermove', handlePointerMove);
      if (frame !== undefined) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [loading, reactionStart, reactionDuration]);

  /**
   * Starts one splash unless loading or already reacting.
   */
  function activateSplash(): void {
    const logo = logoRef.current;
    if (logo === null || loading || reactionStart !== null) {
      return;
    }
    setIsContinuing(false);
    setReactionDuration(1.6);
    setReactionStart(logo.getCurrentTime());
  }

  /**
   * Gives the SVG button the same Enter and Space activation as a native button.
   */
  function handleKeyDown(event: KeyboardEvent<SVGSVGElement>): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!event.repeat) {
        activateSplash();
      }
    }
  }

  return {
    logoRef,
    pupilsRef,
    reactionStart,
    reactionDuration,
    reactionAnimationRef,
    isContinuing,
    activateSplash,
    handleKeyDown,
  };
}
