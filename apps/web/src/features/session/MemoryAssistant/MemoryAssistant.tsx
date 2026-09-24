/**
 * @author Codex
 * @description Floating octopus memory assistant that follows the Session, snaps to the browser viewport edge, and speaks the latest memory observation.
 */
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useStore } from 'zustand';
import { BrainIcon, LoaderCircleIcon, XIcon } from 'lucide-react';
import { OctopusLogo } from '@/components/OctopusLogo';
import { sessionStores } from '@/stores/session';
import { cn } from '@octopus/ui/lib/utils';
import { useI18n } from '@/i18n/use-i18n';
import { describeMemoryAssistantState } from '@/features/session/utils/memory-assistant-status';
import { useMemoryAssistantDrag } from '@/features/session/hooks/use-memory-assistant-drag';
import type { MemoryAssistantTone } from '@/features/session/utils/memory-assistant-status';

const toneBubbleClasses: Record<MemoryAssistantTone, string> = {
  active: 'border-border bg-background/95 text-foreground',
  busy: 'border-sky-200 bg-sky-50/95 text-sky-700 dark:border-sky-900 dark:bg-sky-950/90 dark:text-sky-300',
  warning:
    'border-amber-200 bg-amber-50/95 text-amber-700 dark:border-amber-900 dark:bg-amber-950/90 dark:text-amber-300',
  muted: 'border-border bg-muted/85 text-muted-foreground',
};

const toneTailClasses: Record<MemoryAssistantTone, string> = {
  active: 'bg-background',
  busy: 'bg-sky-50 dark:bg-sky-950',
  warning: 'bg-amber-50 dark:bg-amber-950',
  muted: 'bg-muted',
};

/**
 * Renders the draggable mascot plus its speech bubble; the octopus plays, the bubble manages memory.
 *
 * Closing is session-only on purpose: refreshing the page brings the assistant back.
 */
export function MemoryAssistant({ sessionId }: { sessionId: string }) {
  const { t } = useI18n();
  const state = useStore(sessionStores.ensure(sessionId), (value) => value.memory);
  const status = describeMemoryAssistantState(t, state);
  const { containerRef, position, dragging, handlePointerDown, handleClickCapture, handleKeyDown } =
    useMemoryAssistantDrag();
  const [dismissed, setDismissed] = useState(false);
  const viewportWidth = typeof window === 'undefined' ? 0 : window.innerWidth;
  const bubbleSide: 'left' | 'right' = position.x + 96 > viewportWidth / 2 ? 'left' : 'right';

  if (dismissed) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label="Memory assistant; drag anywhere on screen or nudge with the arrow keys"
      tabIndex={0}
      className={cn(
        'fixed left-0 top-0 z-40 cursor-grab touch-none select-none rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        dragging ? 'cursor-grabbing' : 'cursor-grab'
      )}
      style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0)` }}
      onPointerDown={handlePointerDown}
      onClickCapture={handleClickCapture}
      onKeyDown={handleKeyDown}
    >
      <div className={cn('flex items-center gap-1.5', bubbleSide === 'left' && 'flex-row-reverse')}>
        <div
          className={cn(
            'relative shrink-0 transition-transform duration-150',
            dragging ? 'scale-110' : 'scale-100'
          )}
        >
          <OctopusLogo
            className="size-14 drop-shadow-md sm:size-16"
            label={t('memory.assistant.standby', 'Memory assistant')}
          />
          <div
            aria-hidden="true"
            className="absolute -bottom-1 left-1/2 h-2 w-10 -translate-x-1/2 rounded-full bg-black/15 blur-[3px]"
          />
        </div>
        <div className="relative">
          <Link
            to="/memory"
            draggable={false}
            aria-label={`Memory status: ${status.label}; open global memory management`}
            title={t(
              'memory.assistant.statusLinkTitle',
              'Latest memory status observed by the session; open global memory management'
            )}
            className={cn(
              'relative flex items-center gap-1.5 whitespace-nowrap rounded-2xl border px-2.5 py-1.5 text-xs font-medium shadow-md backdrop-blur-sm transition-colors',
              toneBubbleClasses[status.tone]
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rotate-45 border-border',
                bubbleSide === 'right' ? '-left-1.25 border-b border-l' : '-right-1.25 border-r border-t',
                toneTailClasses[status.tone]
              )}
            />
            {status.busy ? (
              <LoaderCircleIcon className="size-3 animate-spin" aria-hidden="true" />
            ) : (
              <BrainIcon className="size-3" aria-hidden="true" />
            )}
            {status.label}
          </Link>
          <button
            type="button"
            aria-label="Dismiss the memory assistant; it reappears after a page refresh"
            title={t(
              'memory.assistant.dismissTitle',
              'Dismiss the memory assistant (reappears after a refresh)'
            )}
            onClick={() => setDismissed(true)}
            className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-destructive/25 hover:border-destructive/25 hover:text-destructive"
          >
            <XIcon className="size-2.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
